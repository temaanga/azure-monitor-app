require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { WebsiteMonitor } = require('./monitors/websiteMonitor');
const { AzureFileMonitor } = require('./monitors/azureFileMonitor');
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables for admin credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let websiteMonitor = new WebsiteMonitor(config.websites || []);
let azureFileMonitor = new AzureFileMonitor(config.azureFileStorages || []);

let monitoringResults = {
  websites: {},
  azureFiles: {},
  lastUpdate: null
};

async function runMonitoring() {
  console.log('Starting monitoring cycle...');
  
  try {
    const websiteResults = await websiteMonitor.checkAll();
    const azureFileResults = await azureFileMonitor.checkAll();
    
    monitoringResults = {
      websites: websiteResults,
      azureFiles: azureFileResults,
      lastUpdate: new Date().toISOString()
    };
    
    console.log('Monitoring cycle completed');
  } catch (error) {
    console.error('Monitoring error:', error);
  }
}

// JWT Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Authentication endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Check credentials
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Generate JWT token
    const token = jwt.sign(
      { username: username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token: token,
      expiresIn: '24h'
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Token validation endpoint
app.get('/validate-token', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Azure Monitor App',
    status: 'running',
    endpoints: {
      '/health': 'Application health status',
      '/status': 'All monitoring results',
      '/websites': 'Website monitoring results',
      '/azure-files': 'Azure file storage results',
      '/login': 'Admin login (POST)',
      '/config/*': 'Admin configuration (requires auth)'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/status', (req, res) => {
  res.json(monitoringResults);
});

app.get('/websites', (req, res) => {
  res.json({
    websites: monitoringResults.websites,
    lastUpdate: monitoringResults.lastUpdate
  });
});

app.get('/azure-files', (req, res) => {
  res.json({
    azureFiles: monitoringResults.azureFiles,
    lastUpdate: monitoringResults.lastUpdate
  });
});

// Configuration management endpoints (protected)
app.get('/config/websites', authenticateToken, (req, res) => {
  const safeWebsites = config.websites?.map(w => ({
    name: w.name,
    url: w.url
  })) || [];
  res.json(safeWebsites);
});

app.get('/config/azure-storages', authenticateToken, (req, res) => {
  const safeStorages = config.azureFileStorages?.map(s => ({
    name: s.name,
    shareName: s.shareName,
    directories: s.directories || []
  })) || [];
  res.json(safeStorages);
});

app.post('/config/websites', authenticateToken, (req, res) => {
  const { name, url } = req.body;
  
  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }
  
  const newWebsite = { name, url };
  config.websites = config.websites || [];
  config.websites.push(newWebsite);
  
  // Save config and restart monitoring
  require('fs').writeFileSync('./config.json', JSON.stringify(config, null, 2));
  restartMonitoring();
  
  res.json({ message: 'Website added successfully', website: newWebsite });
});

app.post('/config/azure-storages', authenticateToken, (req, res) => {
  const { name, shareName, sasUrl, directories } = req.body;
  
  if (!name || !shareName || !sasUrl) {
    return res.status(400).json({ error: 'Name, shareName, and sasUrl are required' });
  }
  
  const newStorage = {
    name,
    shareName,
    sasUrl,
    directories: directories || []
  };
  
  config.azureFileStorages = config.azureFileStorages || [];
  config.azureFileStorages.push(newStorage);
  
  // Save config and restart monitoring
  require('fs').writeFileSync('./config.json', JSON.stringify(config, null, 2));
  restartMonitoring();
  
  res.json({ message: 'Azure storage added successfully', storage: { name, shareName, directories } });
});

app.delete('/config/websites/:index', authenticateToken, (req, res) => {
  const index = parseInt(req.params.index);
  
  if (index < 0 || index >= config.websites.length) {
    return res.status(404).json({ error: 'Website not found' });
  }
  
  const removed = config.websites.splice(index, 1)[0];
  require('fs').writeFileSync('./config.json', JSON.stringify(config, null, 2));
  restartMonitoring();
  
  res.json({ message: 'Website removed successfully', website: removed });
});

app.delete('/config/azure-storages/:index', authenticateToken, (req, res) => {
  const index = parseInt(req.params.index);
  
  if (index < 0 || index >= config.azureFileStorages.length) {
    return res.status(404).json({ error: 'Storage not found' });
  }
  
  const removed = config.azureFileStorages.splice(index, 1)[0];
  require('fs').writeFileSync('./config.json', JSON.stringify(config, null, 2));
  restartMonitoring();
  
  res.json({ message: 'Storage removed successfully', storage: { name: removed.name, shareName: removed.shareName } });
});

function restartMonitoring() {
  // Recreate monitors with new config
  websiteMonitor = new WebsiteMonitor(config.websites || []);
  azureFileMonitor = new AzureFileMonitor(config.azureFileStorages || []);
}

cron.schedule('*/5 * * * *', runMonitoring);

runMonitoring();

app.listen(PORT, () => {
  console.log(`Azure Monitor App running on port ${PORT}`);
  console.log(`Monitoring ${config.websites?.length || 0} websites and ${config.azureFileStorages?.length || 0} Azure file storages`);
});

module.exports = app;
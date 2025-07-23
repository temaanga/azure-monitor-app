const axios = require('axios');

class WebsiteMonitor {
  constructor(websites) {
    this.websites = websites;
    this.timeout = 10000; // 10 seconds timeout
  }

  async checkWebsite(website) {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(website.url, {
        timeout: this.timeout,
        validateStatus: (status) => status < 500,
        headers: {
          'User-Agent': 'Azure-Monitor-App/1.0'
        }
      });

      const responseTime = Date.now() - startTime;
      
      return {
        url: website.url,
        name: website.name || website.url,
        status: 'up',
        statusCode: response.status,
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        message: `OK - ${response.status}`
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      let errorMessage = 'Unknown error';
      let statusCode = 0;

      if (error.response) {
        statusCode = error.response.status;
        errorMessage = `HTTP ${error.response.status} - ${error.response.statusText}`;
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'DNS resolution failed';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
      } else {
        errorMessage = error.message;
      }

      return {
        url: website.url,
        name: website.name || website.url,
        status: 'down',
        statusCode: statusCode,
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        message: errorMessage
      };
    }
  }

  async checkAll() {
    const results = {};
    
    const promises = this.websites.map(async (website) => {
      const result = await this.checkWebsite(website);
      results[website.url] = result;
    });

    await Promise.all(promises);
    return results;
  }
}

module.exports = { WebsiteMonitor };
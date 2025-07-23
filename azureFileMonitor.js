const { ShareServiceClient } = require('@azure/storage-file-share');

class AzureFileMonitor {
  constructor(storageAccounts) {
    this.storageAccounts = storageAccounts;
  }

  async checkFileStorage(storage) {
    try {
      let shareClient;
      
      if (storage.sasUrl) {
        // Use SAS URL directly
        shareClient = new ShareServiceClient(storage.sasUrl).getShareClient(storage.shareName);
      } else if (storage.credential) {
        // Fallback to credential-based authentication
        const shareServiceClient = new ShareServiceClient(
          `https://${storage.accountName}.file.core.windows.net`,
          storage.credential
        );
        shareClient = shareServiceClient.getShareClient(storage.shareName);
      } else {
        throw new Error('Either sasUrl or credential must be provided');
      }
      
      const exists = await shareClient.exists();
      if (!exists) {
        return {
          accountName: storage.accountName,
          shareName: storage.shareName,
          name: storage.name || `${storage.accountName}/${storage.shareName}`,
          status: 'error',
          fileCount: 0,
          timestamp: new Date().toISOString(),
          message: 'Share does not exist'
        };
      }

      let fileCount = 0;
      let results = {};

      try {
        if (storage.directories && storage.directories.length > 0) {
          // Count files in specific directories only
          for (const dir of storage.directories) {
            const directoryClient = shareClient.getDirectoryClient(dir);
            try {
              const dirResult = await this.countFilesRecursively(directoryClient, dir);
              results[dir] = {
                count: dirResult.count,
                oldestFileDate: dirResult.oldestFile?.toISOString() || null,
                newestFileDate: dirResult.newestFile?.toISOString() || null
              };
              fileCount += dirResult.count;
            } catch (dirError) {
              console.error(`Error counting files in directory ${dir}:`, dirError);
              results[dir] = { error: dirError.message };
            }
          }
        } else {
          // Count all files in root directory (default behavior)
          const directoryClient = shareClient.getDirectoryClient('');
          const result = await this.countFilesRecursively(directoryClient);
          fileCount = result.count;
        }
      } catch (error) {
        console.error(`Error counting files in ${storage.accountName}/${storage.shareName}:`, error);
        
        return {
          accountName: storage.accountName,
          shareName: storage.shareName,
          name: storage.name || `${storage.accountName}/${storage.shareName}`,
          status: 'error',
          fileCount: 0,
          timestamp: new Date().toISOString(),
          message: error.message
        };
      }

      const response = {
        accountName: storage.accountName,
        shareName: storage.shareName,
        name: storage.name || `${storage.accountName}/${storage.shareName}`,
        status: 'ok',
        fileCount: fileCount,
        timestamp: new Date().toISOString(),
        message: `${fileCount} files found`
      };

      // Add directory breakdown if specific directories were monitored
      if (storage.directories && storage.directories.length > 0) {
        response.directoryBreakdown = results;
        response.message = `${fileCount} files found across ${storage.directories.length} directories`;
      }

      return response;

    } catch (error) {
      return {
        accountName: storage.accountName,
        shareName: storage.shareName,
        name: storage.name || `${storage.accountName}/${storage.shareName}`,
        status: 'error',
        fileCount: 0,
        timestamp: new Date().toISOString(),
        message: error.message
      };
    }
  }

  async countFilesRecursively(directoryClient, path = '') {
    let fileCount = 0;
    let oldestFile = null;
    let newestFile = null;
    
    try {
      for await (const item of directoryClient.listFilesAndDirectories()) {
        if (item.kind === 'file') {
          fileCount++;
          
          // Get file properties to access last modified date
          try {
            const fileClient = directoryClient.getFileClient(item.name);
            const properties = await fileClient.getProperties();
            const lastModified = properties.lastModified;
            
            if (!oldestFile || lastModified < oldestFile) {
              oldestFile = lastModified;
            }
            if (!newestFile || lastModified > newestFile) {
              newestFile = lastModified;
            }
          } catch (propError) {
            console.error(`Error getting properties for file ${item.name}:`, propError);
          }
        } else if (item.kind === 'directory') {
          const subDirectoryClient = directoryClient.getDirectoryClient(item.name);
          const subResult = await this.countFilesRecursively(subDirectoryClient, `${path}/${item.name}`);
          
          if (typeof subResult === 'object') {
            fileCount += subResult.count;
            
            // Update oldest/newest from subdirectory
            if (subResult.oldestFile && (!oldestFile || subResult.oldestFile < oldestFile)) {
              oldestFile = subResult.oldestFile;
            }
            if (subResult.newestFile && (!newestFile || subResult.newestFile > newestFile)) {
              newestFile = subResult.newestFile;
            }
          } else {
            // Backward compatibility for simple count
            fileCount += subResult;
          }
        }
      }
    } catch (error) {
      console.error(`Error listing directory ${path}:`, error);
      throw error;
    }

    return {
      count: fileCount,
      oldestFile: oldestFile,
      newestFile: newestFile
    };
  }

  async checkAll() {
    const results = {};
    
    const promises = this.storageAccounts.map(async (storage) => {
      const result = await this.checkFileStorage(storage);
      const key = storage.accountName ? `${storage.accountName}/${storage.shareName}` : storage.name || storage.sasUrl;
      results[key] = result;
    });

    await Promise.all(promises);
    return results;
  }
}

module.exports = { AzureFileMonitor };
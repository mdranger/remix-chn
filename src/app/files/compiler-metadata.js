'use strict'
var executionContext = require('../../execution-context')

class CompilerMetadata {
  constructor (events, opts) {
    var self = this
    self._events = events
    self._opts = opts
    self.networks = ['VM:-', 'main:1', 'ropsten:3', 'rinkeby:4', 'kovan:42', 'Custom']
  }

  syncContractMetadata () {
    var self = this
    self._events.compiler.register('compilationFinished', (success, data, source) => {
      if (!success) return
      if (!self._opts.config.get('settings/generate-contract-metadata')) return
      var provider = self._opts.fileManager.currentFileProvider()
      var path = self._opts.fileManager.currentPath()
      if (provider && path) {
        self._opts.compiler.visitContracts((contract) => {
          if (contract.file !== source.target) return

          var fileName = path + '/' + contract.name + '.json'
          provider.get(fileName, (error, content) => {
            if (!error) {
              content = content || '{}'
              var metadata
              try {
                metadata = JSON.parse(content)
              } catch (e) {
                console.log(e)
              }

              var deploy = metadata.deploy || {}
              self.networks.forEach((network) => {
                deploy[network] = self._syncContext(contract, deploy[network] || {})
              })

              var data = {
                deploy,
                data: {
                  bytecode: contract.object.evm.bytecode,
                  deployedBytecode: contract.object.evm.deployedBytecode,
                  gasEstimates: contract.object.evm.gasEstimates,
                  methodIdentifiers: contract.object.evm.methodIdentifiers
                },
                abi: contract.object.abi
              }

              provider.set(fileName, JSON.stringify(data, null, '\t'))
            }
          })
        })
      }
    })
  }

  _syncContext (contract, metadata) {
    var linkReferences = metadata['linkReferences']
    var autoDeployLib = metadata['autoDeployLib']
    if (!linkReferences) linkReferences = {}
    if (autoDeployLib === undefined) autoDeployLib = true

    for (var libFile in contract.object.evm.bytecode.linkReferences) {
      if (!linkReferences[libFile]) linkReferences[libFile] = {}
      for (var lib in contract.object.evm.bytecode.linkReferences[libFile]) {
        if (!linkReferences[libFile][lib]) {
          linkReferences[libFile][lib] = '<address>'
        }
      }
    }
    metadata['linkReferences'] = linkReferences
    metadata['autoDeployLib'] = autoDeployLib
    return metadata
  }

  deployMetadataOf (contractName, callback) {
    var self = this
    var provider = self._opts.fileManager.currentFileProvider()
    var path = self._opts.fileManager.currentPath()
    if (provider && path) {
      executionContext.detectNetwork((err, { id, name } = {}) => {
        if (err) {
          console.log(err)
        } else {
          var fileName = path + '/' + contractName + '.json'
          provider.get(fileName, (error, content) => {
            if (error) return callback(error)
            if (!content) return callback()
            try {
              var metadata = JSON.parse(content)
              metadata = metadata.deploy || {}
              return callback(null, metadata[name + ':' + id] || metadata[name] || metadata[id] || metadata[name.toLowerCase() + ':' + id] || metadata[name.toLowerCase()])
            } catch (e) {
              callback(e.message)
            }
          })
        }
      })
    }
  }
}

module.exports = CompilerMetadata

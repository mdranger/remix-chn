'use strict'
var Ethdebugger = require('remix-debug').EthDebugger
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager
var traceHelper = remixLib.helpers.trace

var StepManager = require('./stepManager')
var VmDebuggerLogic = require('./VmDebugger')

function Debugger (options) {
  var self = this
  this.event = new EventManager()

  this.executionContext = options.executionContext
  // dependencies
  this.offsetToLineColumnConverter = options.offsetToLineColumnConverter
  this.compilersArtefacts = options.compilersArtefacts

  this.debugger = new Ethdebugger({
    executionContext: options.executionContext,
    compilationResult: () => {
      if (this.compilersArtefacts['__last']) return this.compilersArtefacts['__last'].getData()
      return null
    }
  })

  this.breakPointManager = new remixLib.code.BreakpointManager(this.debugger, (sourceLocation) => {
    if (!this.compilersArtefacts['__last']) return null
    let compilationData = this.compilersArtefacts['__last'].getData()
    if (!compilationData) return null
    return self.offsetToLineColumnConverter.offsetToLineColumn(sourceLocation, sourceLocation.file, compilationData.sources, compilationData.sources)
  }, (step) => {
    self.event.trigger('breakpointStep', [step])
  })

  this.debugger.setBreakpointManager(this.breakPointManager)

  this.executionContext.event.register('contextChanged', this, function (context) {
    self.debugger.switchProvider(context)
  })

  this.debugger.event.register('newTraceLoaded', this, function () {
    self.event.trigger('debuggerStatus', [true])
  })

  this.debugger.event.register('traceUnloaded', this, function () {
    self.event.trigger('debuggerStatus', [false])
  })

  this.event.register('breakpointStep', function (step) {
    self.step_manager.jumpTo(step)
  })

  this.debugger.addProvider('vm', this.executionContext.vm())
  this.debugger.addProvider('injected', this.executionContext.internalWeb3())
  this.debugger.addProvider('web3', this.executionContext.internalWeb3())
  this.debugger.switchProvider(this.executionContext.getProvider())
}

Debugger.prototype.registerAndHighlightCodeItem = function (index) {
  const self = this
  // register selected code item, highlight the corresponding source location
  if (!self.compilersArtefacts['__last']) {
    self.event.trigger('newSourceLocation', [null])
    return
  }
  var compilerData = self.compilersArtefacts['__last'].getData()
  self.debugger.traceManager.getCurrentCalledAddressAt(index, (error, address) => {
    if (error) return console.log(error)
    self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, index, compilerData.contracts, function (error, rawLocation) {
      if (!error) {
        var lineColumnPos = self.offsetToLineColumnConverter.offsetToLineColumn(rawLocation, rawLocation.file, compilerData.sources, compilerData.sources)
        self.event.trigger('newSourceLocation', [lineColumnPos, rawLocation])
      } else {
        self.event.trigger('newSourceLocation', [null])
      }
    })
  })
}

Debugger.prototype.debug = function (blockNumber, txNumber, tx, loadingCb) {
  const self = this
  let web3 = this.executionContext.web3()

  if (this.debugger.traceManager.isLoading) {
    return
  }

  self.debugger.solidityProxy.reset({})

  if (tx) {
    if (!tx.to) {
      tx.to = traceHelper.contractCreationToken('0')
    }
    return self.debugTx(tx, loadingCb)
  }

  if (txNumber.indexOf('0x') !== -1) {
    return web3.eth.getTransaction(txNumber, function (_error, result) {
      let tx = result
      self.debugTx(tx, loadingCb)
    })
  }
  web3.eth.getTransactionFromBlock(blockNumber, txNumber, function (_error, result) {
    let tx = result
    self.debugTx(tx, loadingCb)
  })
}

Debugger.prototype.debugTx = function (tx, loadingCb) {
  const self = this
  this.step_manager = new StepManager(this.debugger, this.debugger.traceManager)

  this.debugger.codeManager.event.register('changed', this, (code, address, instIndex) => {
    self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, this.step_manager.currentStepIndex, this.debugger.solidityProxy.contracts, (error, sourceLocation) => {
      if (!error) {
        self.vmDebuggerLogic.event.trigger('sourceLocationChanged', [sourceLocation])
      }
    })
  })

  this.vmDebuggerLogic = new VmDebuggerLogic(this.debugger, tx, this.step_manager, this.debugger.traceManager, this.debugger.codeManager, this.debugger.solidityProxy, this.debugger.callTree)

  this.step_manager.event.register('stepChanged', this, function (stepIndex) {
    self.debugger.codeManager.resolveStep(stepIndex, tx)
    self.step_manager.event.trigger('indexChanged', [stepIndex])
    self.vmDebuggerLogic.event.trigger('indexChanged', [stepIndex])
    self.registerAndHighlightCodeItem(stepIndex)
  })

  loadingCb()
  this.debugger.debug(tx)
}

Debugger.prototype.unload = function () {
  this.debugger.unLoad()
  this.event.trigger('debuggerUnloaded')
}

module.exports = Debugger

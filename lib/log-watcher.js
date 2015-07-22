/*

 Copyright 2015 Telefonica Investigación y Desarrollo, S.A.U

 This file is part of Tartare.

 Tartare is free software: you can redistribute it and/or modify it under the
 terms of the Apache License as published by the Apache Software Foundation,
 either version 2.0 of the License, or (at your option) any later version.
 Tartare is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the Apache License for more details.

 You should have received a copy of the Apache License along with Tartare.
 If not, see http://www.apache.org/licenses/LICENSE-2.0

 For those usages not covered by the Apache License please contact with:
 joseantonio.rodriguezfernandez@telefonica.com

 */

'use strict';

var util = require('util'),
    EventEmitter = require('events').EventEmitter,
    os = require('os'),
    fs = require('fs'),
    path = require('path'),
    Stream = require('stream'),
    jsonValidator = require('is-my-json-valid');

/**
 * This class is a log watcher, that is, an object that is either watching a log file (waiting for changes on it)
 * or listening to 'data' events coming from a stream.
 * It is an event emitter, that emits 'log' events when new log entries are written to the file or the stream.
 * The 'log' event will convey an object with the parsed log entry. How this object is built depends on the
 * method used to parse log entries, which is given by the 'config' parameter.
 * It also emits 'error' events when some error happens.
 *
 * @param source - From which the logs will come (a string with the path to a file or a stream where the logs
 *          will be written).
 * @param config - Object that tell the watcher how to parse each log entry in order to build the object sent
 *          with each 'log' event. The following methods are supported:
 *            - RegExp: Each log entry is matched against a regular expression containing capturing groups.
 *                Each capturing group will be a field value, while field names are provided as an array where
 *                the nth element is the name of the nth capturing group. To use this method include in the config
 *                object a 'pattern' property with the regular expression and a 'fieldNames' property with an
 *                array of field names.
 *            - JSON: Each log entry is parsed as a JSON document. To use this method include a 'json' property
 *                with a truthy value in the config object. Optionally, you can include a 'schema' property
 *                whose value is a JSON Schema that will be used to validate each log entry. This schema can be
 *                a JavaScript object or a String.
 *            - Custom: Each log entry is passed to a custom function. This function receives a String and returns
 *                an object with the parsed data (or null if the log entry cannot be parsed). To use this method
 *                include a 'fn' property with the custom function in the config object.
 * @param opts - Supported values:
 *          - autoStart: If true, the log watcher will start watching the log file
 *              or listening to the stream immediately.
 *          - polling: If true, the log watcher will prefer a polling strategy instead of listening to filesystem
 *              events (useful for filesystems where watching is not reliable, or does not work at all). Polling
 *              interval is set using the interval option.
 *          - interval: If polling is true, this is the interval (in ms) used to poll the log file (Defaults to 100).
 *          - allowPatternViolations (defaults to false): When using the RegExp method and this property is set to
 *              true, if a log entry does not match the pattern, it will be added to the previous log entry
 *              (useful to support logs with stacktraces, config object, and any other kind of dump). If this
 *              property is set to false, an 'error' event will be emitted if the log entry does not match
 *              the regular expression.
 *          - retainedLogTimeout (defaults to 300): Timeout (in ms) to emit a log that has been retained
 *              just in case it were not a complete log (because the last change in the log file or the stream
 *              could be part of this log). Only valid for the RegExp method.
 * @constructor
 */
var LogWatcher = function LogWatcher(source, config, opts) {
  EventEmitter.call(this);

  this.source = source;
  this.config = config;
  if (config.json) {
    this.method = 'json';
    if (config.schema) {
      this._jsonValidate = jsonValidator(config.schema, {verbose: true});
    }
  } else if (config.fn instanceof Function) {
    this.method = 'custom';
  } else if (util.isRegExp(config.pattern) && Array.isArray(config.fieldNames)) {
    this.method = 'regexp';
  } else {
    throw new Error('LogWatcher: Non supported method');
  }
  this.opts = opts || {};
  this.opts.polling = this.opts.polling || false;
  this.opts.interval = this.opts.interval || 100;
  this.opts.allowPatternViolations = this.opts.allowPatternViolations || false;
  this.opts.retainedLogTimeout = this.opts.retainedLogTimeout || 300;

  this._started = false;
  this._fileWatcher = null;
  this._fileWatcherTimeoutId = null;
  this._stream = null;
  this._retainedLogTimeoutId = null;
  this._partialData = '';
  this._logs = [];

  var autoStart = this.opts.autoStart || false;
  if (autoStart) {
    this.start();
  }
};
util.inherits(LogWatcher, EventEmitter);

/**
 * Start watching the log file or listening to the stream. If the log file is already been watching, it does nothing.
 */
LogWatcher.prototype.start = function start() {
  if (this._started) {
    return;
  }

  if (this.source instanceof Stream) {
    this._startStreamListening(this.source);
  } else {
    this._startFileWatching(this.source);
  }

  this._started = true;
};

/**
 * Start watching a log file.
 */
LogWatcher.prototype._startFileWatching = function _startFileWatching(logFilePath) {
  var self = this;
  var prevSize;

  // Get the file size, or null if it does not exist, instead of throwing an error
  function _getFileSize(path_) {
    try {
      return fs.statSync(path_).size;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  function _readLogFile(prevSize_, currSize_) {
    if (prevSize_ >= currSize_) {
      return;  // Nothing to read
    }

    // Read the new data just written to the file
    var buffer = new Buffer(currSize_ - prevSize_);
    var fd = fs.openSync(logFilePath, 'r');
    fs.readSync(fd, buffer, 0, currSize_ - prevSize_, prevSize_);
    fs.closeSync(fd);

    // Parse the new data to get the logs
    self._parseLogData(buffer.toString());
  }

  // Try to get the initial log file size
  prevSize = _getFileSize(logFilePath) || 0;

  if (self.opts.polling) {
    var _pollFile = function _pollFile() {
      var currSize = _getFileSize(logFilePath);
      if (currSize !== null) {
        _readLogFile(prevSize, currSize);
        prevSize = currSize;
      }
      // Schedule next poll
      self._fileWatcherTimeoutId = setTimeout(_pollFile, self.opts.interval);
    };
    // Start polling
    _pollFile();
  } else {  // Not polling
    // Watch the directory instead of the log file to ensure we detect the file creation in case it does not exist
    self._fileWatcher = fs.watch(path.dirname(logFilePath), {persistent: false, recursive: false}, function() {
      // It doesn't matter the event or the filename, always try to read the new log file data
      var currSize = _getFileSize(logFilePath);
      if (currSize !== null) {
        _readLogFile(prevSize, currSize);
        prevSize = currSize;
      }
    });
  }
};

/**
 * Start listening to a stream.
 */
LogWatcher.prototype._startStreamListening = function _startStreamListening(stream) {
  this._stream = stream;
  // Save the bound version of the listeners
  this._onData = this._onData.bind(this);
  this._onError = this._onError.bind(this);
  // Add the bound listeners to the stream
  this._stream.on('data', this._onData);
  this._stream.on('error', this._onError);
};

LogWatcher.prototype._onData = function _onData(chunk) {
  // Parse the new data to get the logs
  this._parseLogData(chunk.toString());
};

LogWatcher.prototype._onError = function _onError(err) {
  this.emit('error', err);
};

/**
 * Parse the logs read from a file or a stream, and emit the corresponding events
 */
LogWatcher.prototype._parseLogData = function _parseLogs(data) {
  var self = this;

  // There are new data. Clear the retained log timeout, because the retained log will be pushed by the new data
  clearTimeout(self._retainedLogTimeoutId);

  // Parse the new data to get the logs
  data = self._partialData + data;
  self._partialData = '';
  var lines = data.split(os.EOL);
  if (data.slice(-1) !== os.EOL) {
    // If it does not ends with EOL, store the partial line to be merged with the next chunk
    self._partialData = lines.pop();
  }
  lines.forEach(function(line) {
    if (line.trim() === '') {
      return;
    }
    // Parse the log entry according to the chosen method
    try {
      var log = self._parseLogEntry(line);
    }
    catch (err) {
      // In case the log entry cannot be parsed
      if (self.method === 'regexp' && self.opts.allowPatternViolations && self._logs.length) {
        // When using the RegExp method, if the previous line is a valid log and pattern violations are allowed,
        // add the current line to the last field of the last log that matched the pattern
        self._logs[self._logs.length - 1][self.config.fieldNames[self.config.fieldNames.length - 1]] += os.EOL + line;
        return;
      } else {
        // When using another method, or using the RegExp method but pattern violations are not allowed or
        // there are not any log matching the pattern yet, emit an error
        var parseErr = new Error('LogWatcher: log line cannot be parsed: ' + line);
        parseErr.details = {message: err.message};
        for (var errProperty in err) {
          parseErr.details[errProperty] = err[errProperty];
        }
        self.emit('error', parseErr);
        return;
      }
    }

    // Add the a new log to the log list
    self._logs.push(log);
  });

  // Emit the logs
  if (self.method === 'regexp') {
    // Emit logs applying the retention policy
    self._logs.forEach(function(log, index) {
      if (index < self._logs.length - 1) {
        // Emit logs except for the last one. The last one will be retained just in case it is an incomplete log
        // (although it matches the pattern) that will be completed by upcoming log lines.
        self.emit('log', log);
      } else {
        // This log will be retained.
        // Set a timeout in order to emit the retained log after some time, to avoid infinitely retain a log
        // because it could be the last log.
        self._retainedLogTimeoutId = setTimeout(function(retainedLog) {
          self.emit('log', retainedLog);
          self._logs = [];
        }, self.opts.retainedLogTimeout, log);
      }
    });
    // The logs buffer keep the last log (the retained one)
    self._logs = self._logs.slice(-1);
  } else {
    // Emit all the logs
    self._logs.forEach(function(log) {
      self.emit('log', log);
    });
    // Empty the logs buffer
    self._logs = [];
  }
};

/**
 * Parse a log entry (a line) and return an object with the log data
 */
LogWatcher.prototype._parseLogEntry = function _parseLogEntry(logEntry) {
  var self = this;
  var log;
  var err;

  switch (self.method) {
    case 'regexp':
      var fieldsValues = logEntry.trim().match(this.config.pattern);
      if (fieldsValues) {
        // Remove the first element, which contains the whole matched string
        fieldsValues = fieldsValues.slice(1);
        log = {};
        for (var i = 0; i < fieldsValues.length; i++) {
          log[this.config.fieldNames[i]] = fieldsValues[i];
        }
      } else {
        err = new Error('Log does not match the pattern');
        err.logEntry = logEntry;
        throw err;
      }
      break;

    case 'json':
      try {
        log = JSON.parse(logEntry);
      } catch (err_) {
        err = new Error('Log is not a JSON document');
        err.logEntry = logEntry;
        err.reason = err_.message;
        throw err;
      }
      if (this.config.schema) {
        if (!this._jsonValidate(log)) {
          err = new Error('Log does not follow the JSON Schema');
          err.logEntry = logEntry;
          err.reason = this._jsonValidate.errors;
          throw err;
        }
      }
      break;

    case 'custom':
      log = this.config.fn(logEntry);
      break;
  }

  return log;
};

/**
 * Stop watching the log file or listening to the stream
 */
LogWatcher.prototype.stop = function stop() {
  if (this._fileWatcher) {
    this._fileWatcher.close();
    this._fileWatcher = null;
  }
  if (this._fileWatcherTimeoutId) {
    clearTimeout(this._fileWatcherTimeoutId);
    this._fileWatcherTimeoutId = null;
  }
  if (this._stream) {
    // Remove the bound listeners
    this._stream.removeListener('data', this._onData);
    this._stream.removeListener('error', this._onError);
    this._stream = null;
  }
  this._started = false;
};

module.exports = LogWatcher;

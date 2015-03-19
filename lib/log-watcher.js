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
    watchr = require('watchr'),
    os = require('os'),
    fs = require('fs'),
    path = require('path'),
    Stream = require('stream');

/**
 * This class is a log watcher, that is, an object that is either watching a log file (waiting for changes on it)
 * or listening to 'data' events coming from a stream.
 * It is an event emitter, that emits 'log' events when new log entries are written to the file or the stream.
 * Log entries are matched against the provided pattern so the 'log' event will have an object whose fields will be
 * the ones captured by the pattern (using the names in the 'fieldNames' parameter).
 * It also emits 'error' events when some error happens.
 *
 * @param source from which the logs will come (a string with the path to a file or a stream
 *               where the logs will be written)
 * @param pattern RegExp against which each new log entry will be matched to extract the log fields
 * @param fieldNames Array of field names used to build the object emitted by the 'log' event,
 *               using the values gathered from matching the pattern against a log entry
 * @param opts Supported values:
 *               - autoStart: If true, the log watcher will starts watching the log file or
 *                   listening to the stream immediately
 *               - allowPatternViolations (defaults to false): If true, log entries not matching the pattern will not
 *                   emit an error, but will be added to the previous log entry. Useful to support logs
 *                   with stacktraces, config object, and any other kind of dump.
 *               - retainedLogTimeout: Timeout to emit a log that has been retained just in case it were not a
 *                   complete log (because the last change in the log file or the stream could be part of this log)
 *               - The following options supported by the watchr module:
 *                   - interval (defaults to 2000)
 *                   - catchupDelay (defaults to 0)
 * @constructor
 */
var LogWatcher = function LogWatcher(source, pattern, fieldNames, opts) {
  EventEmitter.call(this);

  this.source = source;
  this.pattern = pattern;
  this.fieldNames = fieldNames;
  this.opts = opts || {};
  this.allowPatternViolations = opts.allowPatternViolations || false;
  this.retainedLogTimeout = opts.retainedLogTimeout || 300;

  this._started = false;
  this._fileWatcher = null;
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

  // If the log file exists, watch the file. Otherwise, watch the directory to detect the file creation and updates
  var watchPath;
  try {
    fs.statSync(logFilePath);
    watchPath = logFilePath;
  } catch (err) {
    watchPath = path.dirname(logFilePath);
  }

  var lastSize = 0;

  // Start watching...
  watchr.watch({
    path: watchPath,
    interval: self.opts.interval || 2000,
    persistent: false,
    catchupDelay: self.opts.catchupDelay || 0,
    listeners: {
      error: function(err) {
        self.emit('error', err);
      },
      /* eslint-disable no-unused-vars */
      watching: function(err, watcherInstance, isWatching) {
      /* eslint-enable no-unused-vars */
        if (err) {
          return self.emit('error', err);
        }
        // Everything went fine, log file is being watched
        self._fileWatcher = watcherInstance;
      },
      change: function(changeType, filePath, currentStats, previousStats) {
        // We're only interested on changes over the watched file
        if (filePath !== logFilePath) {
          return;
        }
        // We're only interested on 'create' or 'update' events
        if (changeType !== 'create' && changeType !== 'update') {
          return;
        }
        if (!previousStats) {
          previousStats = {size: 0};
        }

        // Fix stats when the reported range overlaps with a previous range
        previousStats.size = Math.max(previousStats.size, lastSize);
        if (previousStats.size === currentStats.size) {
          // Do nothing if there is nothing to read once the former fix has been applied
          return;
        }
        lastSize = currentStats.size;

        // Read the new data just written to the file
        var buffer = new Buffer(currentStats.size - previousStats.size);
        var fd = fs.openSync(logFilePath, 'r');
        fs.readSync(fd, buffer, 0, currentStats.size - previousStats.size, previousStats.size);
        fs.closeSync(fd);

        // Parse the new data to get the logs
        self._parseLogs(buffer.toString());
      }
    }
  });
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
  this._parseLogs(chunk.toString());
};

LogWatcher.prototype._onError = function _onError(err) {
  this.emit('error', err);
};

/**
 * Parse the logs read from a file or a stream, and emit the corresponding events
 */
LogWatcher.prototype._parseLogs = function _parseLogs(data) {
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
    var fieldsValues = line.trim().match(self.pattern);
    if (fieldsValues === null) {
      // In case the log entry does not match the pattern
      if (self.allowPatternViolations && self._logs.length) {
        // If the previous line is a valid log and pattern violations are allowed,
        // add the current line to the last field of the last log that matched the pattern
        self._logs[self._logs.length - 1][self.fieldNames[self.fieldNames.length - 1]] += os.EOL + line;
        return;
      } else {
        // If pattern violations are not allowed or there are not any log matching the pattern yet, emit an error
        self.emit('error', new Error('LogWatcher: log line does not follow the given pattern: ' + line));
        return;
      }
    }
    // This is a log entry matching the pattern, build the log object
    var log = {};
    for (var i = 1; i < fieldsValues.length; i++) {
      log[self.fieldNames[i - 1]] = fieldsValues[i];
    }

    // This is a new log, add it to the log list
    self._logs.push(log);
  });

  // Emit the logs
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
      }, self.retainedLogTimeout, log);
    }
  });
  // The logs buffer keep the last log (the retained one)
  self._logs = self._logs.slice(-1);
};

/**
 * Stop watching the log file or listening to the stream
 */
LogWatcher.prototype.stop = function stop() {
  if (this._fileWatcher) {
    this._fileWatcher.close();
    this._fileWatcher = null;
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

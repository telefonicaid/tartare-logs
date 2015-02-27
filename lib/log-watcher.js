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
    path = require('path');

/**
 * This class is a log file watcher, that is, an object that is watching a log file, waiting for changes on it.
 * It is an event emitter, that emit 'log' events when new log entries are written to the file.
 * Log entries are matched against the provided pattern so the 'log' event will have an object
 * It also emit 'error' events when some error happen.
 *
 * @param logFilePath
 * @param pattern RegExp against which each new log entry will be matched to extract the log fields
 * @param fieldNames Array of field names used to build the object emitted by the 'log' event,
 *               using the values gathered from matching the pattern against a log entry
 * @param opts Supported values:
 *               - autoStart: If true, the log watcher start watching the log file immediately
 *               - allowPatternViolations (defaults to false): If true, log entries not matching the pattern will not
 *                   emit an error, but will be added to the previous log entry. Useful to support logs
 *                   with stacktraces, and any other kink of dump.
 *               - retainedLogTimeout: Timeout no emit a log that has been retained just in case it were not a
 *                   complete log (because the last change in the log file could be part of this log)
 *               - The following options supported by the watchr module:
 *                   - interval (defaults to 2000)
 *                   - catchupDelay (defaults to 0)
 * @constructor
 */
var LogWatcher = function LogWatcher(logFilePath, pattern, fieldNames, opts) {
  EventEmitter.call(this);

  this.logFilePath = logFilePath;
  this.pattern = pattern;
  this.fieldNames = fieldNames;
  this.opts = opts || {};
  this.allowPatternViolations = opts.allowPatternViolations || false;
  this.retainedLogTimeout = opts.retainedLogTimeout || 300;
  this.watcher = null;

  var autoStart = this.opts.autoStart || false;
  if (autoStart) {
    this.start();
  }
};
util.inherits(LogWatcher, EventEmitter);

/**
 * Start watching the log file. If the log file is already been watching, it does nothing.
 */
LogWatcher.prototype.start = function start() {
  var self = this;
  if (self.watcher) {
    return;
  }

  // If the log file exists, watch the file. Otherwise, watch the directory to detect the file creation and updates
  var watchPath;
  try {
    fs.statSync(self.logFilePath);
    watchPath = self.logFilePath;
  } catch (err) {
    watchPath = path.dirname(self.logFilePath);
  }

  var lastSize = 0;
  var partialBuffer = '';
  var logs = [];
  var retainedLogTimeoutId;

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
        self.watcher = watcherInstance;
      },
      change: function(changeType, filePath, currentStats, previousStats) {
        // We're only interested on changes over the watched file
        if (filePath !== self.logFilePath) {
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

        // There are new data. Clear the retained log timeout, because the retained log will be pushed by the new data
        clearTimeout(retainedLogTimeoutId);

        // Read the new data just written to the file
        var buffer = new Buffer(currentStats.size - previousStats.size);
        var fd = fs.openSync(self.logFilePath, 'r');
        fs.readSync(fd, buffer, 0, currentStats.size - previousStats.size, previousStats.size);
        fs.closeSync(fd);

        // Parse the new data to get the logs
        buffer = partialBuffer + buffer.toString();
        partialBuffer = '';
        var lines = buffer.split(os.EOL);
        if (buffer.slice(-1) !== os.EOL) {
          // If it does not ends with EOL, store the partial line to be merged with the next chunk
          partialBuffer = lines.pop();
        }
        lines.forEach(function(line) {
          if (line.trim() === '') {
            return;
          }
          var fieldsValues = line.trim().match(self.pattern);
          if (fieldsValues === null) {
            // In case the log entry does not match the pattern
            if (self.allowPatternViolations && logs.length) {
              // If the previous line is a valid log and pattern violations are allowed,
              // add the current line to the last field of the last log that matched the pattern
              logs[logs.length - 1][self.fieldNames[self.fieldNames.length - 1]] += os.EOL + line;
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
          logs.push(log);
        });
        // Emit the logs
        logs.forEach(function(log, index) {
          if (index < logs.length - 1) {
            // Emit logs except for the last one. The lat one will be retained just in case it is an incomplete log
            // (although it matches the pattern) that will be completed by upcoming log lines.
            self.emit('log', log);
          } else {
            // This log will be retained.
            // Set a timeout in order to emit the retained log after some time, to avoid infinitely retain a log
            // because it could be the last log.
            retainedLogTimeoutId = setTimeout(function(retainedLog) {
              self.emit('log', retainedLog);
              logs = [];
            }, self.retainedLogTimeout, log);
          }
        });
        // The logs buffer keep the last log (the retained one)
        logs = logs.slice(-1);
      }
    }
  });

};

/**
 * Stop watching the log file
 */
LogWatcher.prototype.stop = function stop() {
  if (this.watcher) {
    this.watcher.close();
    this.watcher = null;
  }
};

module.exports = LogWatcher;

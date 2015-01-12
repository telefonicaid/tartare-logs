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

var EventEmitter = require('events').EventEmitter,
    os = require('os'),
    LogWatcher = require('./log-watcher');

/**
 * This stateful class represents a log file that is being watched. Logs (and error) events are internally stored
 * waiting for an external query to ask for the existence of a log that matches a template.
 *
 * @param logFilePath
 * @param pattern to be passed to the LogWatcher
 * @param fieldNames to be passed to the LogWatcher
 * @param opts to be passed to the LogWatcher
 * @constructor
 */
var LogReader = function LogReader(logFilePath, pattern, fieldNames, opts) {
  this.logWatcher = new LogWatcher(logFilePath, pattern, fieldNames, opts);
  this.logs = [];
  this.errors = [];
  this.internalDispatcher = new EventEmitter();
};

/**
 * Start watching the log file. Logs will be internally stored.
 */
LogReader.prototype.start = function start() {
  var self = this;

  self.stop();
  self.logs.length = 0;
  self.errors.length = 0;
  self.logWatcher.start();

  self.logWatcher.on('log', function(log) {
    self.logs.push(log);
    self.internalDispatcher.emit('internallog', log);
  });

  self.logWatcher.on('error', function(err) {
    self.errors.push(err);
    self.internalDispatcher.emit('internalerror', err);
  });
};

/**
 * Stop watching the log file.
 */
LogReader.prototype.stop = function stop() {
  this.logWatcher.removeAllListeners();
  this.logWatcher.stop();
};

LogReader.prototype._matches = function _matches(log, logTemplate) {
  return Object.keys(logTemplate).map(function(fieldName) {
    if (!log[fieldName]) {
      // If the log has not that field, then it does not match the template
      return false;
    }
    if (logTemplate[fieldName] instanceof RegExp) {
      return (log[fieldName].match(logTemplate[fieldName]) !== null);
    } else {
      return (log[fieldName] === logTemplate[fieldName]);
    }
  }).reduce(function(previous, value) {
    return previous && value;
  });
};

/**
 * This function look for a log in the logs list that matches de logTemplate. In case the log is not found, it will
 * wait up to timeout before calling the callback. Meanwhile, new log events coming from the logWatcher could bring
 * the wanted log, in which case this function will call the callback if it occurs before the timeout expires.
 * The logTemplate is an object whose field names are the field names to search in the log, and whose values are
 * the expected values or a RegExp against which the log value will be matched.
 *
 * @param logTemplate
 * @param timeout in ms (defaults to 3000)
 * @param cb
 */
LogReader.prototype.waitForLogsToExist = function waitForLogsToExist(logTemplate, timeout, cb) {
  if (!cb && timeout instanceof Function) {
    cb = timeout;
    timeout = null;
  }
  timeout = timeout || 3000;
  var self = this;

  var timeoutId = setTimeout(function() {
    self.internalDispatcher.removeAllListeners();
    var err = new Error('No logs have been found after waiting ' + timeout + 'ms');
    err.logs = self.logs;
    cb(err);
  }, timeout);

  if (self.errors.length) {
    // If there is some log error, call the callback immediately reporting the errors
    return cb(new Error(self.errors.map(function(error) {
      return error.message;
    }).join(os.EOL)));
  }

  var foundLog = null;
  for (var i = 0; i < self.logs.length; i++) {
    if (self._matches(self.logs[i], logTemplate)) {
      foundLog = self.logs[i];
      break;
    }
  }

  if (foundLog) {
    // The log has been found in the already received logs
    clearTimeout(timeoutId);
    return cb(null, foundLog);
  } else {
    // If the log has not been found, it could came in the near future, so subscribe to new logs/errors
    self.internalDispatcher.on('internallog', function(log) {
      if (self._matches(log, logTemplate)) {
        clearTimeout(timeoutId);
        self.internalDispatcher.removeAllListeners();
        return cb(null, log);
      }
    });
    self.internalDispatcher.on('internalerror', function(err) {
      clearTimeout(timeoutId);
      self.internalDispatcher.removeAllListeners();
      return cb(new Error(err.message));
    });
  }
};

module.exports = LogReader;

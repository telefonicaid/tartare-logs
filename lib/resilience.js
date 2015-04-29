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

var fs = require('fs'),
    rimraf = require('rimraf'),
    exec = require('child_process').exec;

/*
 RESILIENCE: Set of utils to test logging subsystems resilience
 */

/**
 * Check whether the logFile exists
 * @param logFile
 * @param cb
 */
var doesLogFileExist = function doesLogFileExist(logFile, cb) {
  fs.stat(logFile, function(err) {
    if (err && err.code === 'ENOENT') {
      return cb(null, false);
    }
    if (err) {
      return cb(err);
    }
    cb(null, true);
  });
};

/**
 * Returns the size (in bytes) of the logFile
 * @param logFile
 * @param cb
 */
var getLogFileSize = function getLogFileSize(logFile, cb) {
  fs.stat(logFile, function(err, stats) {
    if (err) {
      return cb(err);
    }
    cb(null, stats.size);
  });
};

/**
 * Simulate a log rotation truncating the file to size zero
 * @param logFile
 * @param cb
 */
var rotateLogFile = function rotateLogFile(logFile, cb) {
  fs.truncate(logFile, 0, cb);
};

/**
 * Removes the logFile, and finishes silently if the logFile does not exist
 * @param logFile
 * @param cb
 */
var removeLogFile = function removeLogFile(logFile, cb) {
  fs.unlink(logFile, function(err) {
    if (!err || err.code === 'ENOENT') {
      err = null;
    }
    cb(err);
  });
};

/**
 * Creates a directory with read-only permissions
 * @param path
 * @param cb
 */
var createReadOnlyDir = function createReadOnlyDir(path, cb) {
  rimraf(path, function(err) {
    if (err) {
      return cb(err);
    }
    fs.mkdir(path, '0555', cb);
  });
};

/**
 * Remove a directory and any content it could have
 * @param path
 * @param cb
 */
var removeDir = function removeDir(path, cb) {
  rimraf(path, cb);
};

/**
 * Create a temp file system with the given size.
 * Useful to simulate a partition with very few space, that will become full when the SUT write logs.
 * @param path
 * @param size
 * @param cb
 */
var createLogFS = function createLogFS(path, size, cb) {
  fs.mkdir(path, null, function(err) {
    if (err) {
      return cb(err);
    }
    /* eslint-disable no-shadow */
    exec('sudo mount -t tmpfs -o size=' + size + 'k tmpfs ' + path, function(err) {
      /* eslint-enable no-shadow */
      if (err) {
        rimraf(path, cb);
      }
      cb();
    });
  });
};

/**
 * Remove the temp file system.
 * @param path
 * @param cb
 */
var removeLogFS = function createLogFS(path, cb) {
  exec('sudo umount ' + path, function(err) {
    if (err) {
      return cb(err);
    }
    rimraf(path, cb);
  });
};

/**
 * Remove write permissions from the logFile
 * @param logFile
 * @param cb
 */
var removeWritePermissionFromLogFile = function removeWritePermissionFromLogFile(logFile, cb) {
  fs.chmod(logFile, '0466', cb);
};

/**
 * Add write permissions to the logFile
 * @param logFile
 * @param cb
 */
var addWritePermissionToLogFile = function addWritePermissionToLogFile(logFile, cb) {
  fs.chmod(logFile, '0666', cb);
};

module.exports = {
  doesLogFileExist: doesLogFileExist,
  getLogFileSize: getLogFileSize,
  rotateLogFile: rotateLogFile,
  removeLogFile: removeLogFile,
  createReadOnlyDir: createReadOnlyDir,
  removeDir: removeDir,
  createLogFS: createLogFS,
  removeLogFS: removeLogFS,
  removeWritePermissionFromLogFile: removeWritePermissionFromLogFile,
  addWritePermissionToLogFile: addWritePermissionToLogFile
};

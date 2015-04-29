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

module.exports = function(chai) {
  var Assertion = chai.Assertion;

  Assertion.addMethod('throwLogNotFoundError', function assertThrowLogNotFoundError(logTemplate, opts) {
    var waitForLogsToExistFn = this._obj,
        foundLog = null,
        fnErr = null;

    try {
      foundLog = waitForLogsToExistFn(logTemplate, opts);
    } catch (err) {
      if (err.logs) {
        // It's a LogNotFound error
        fnErr = err;
      } else {
        throw err;
      }
    }

    this.assert(
        fnErr !== null,
        'The following log has been found, but it should not be there:\n#{act}',
        'None of the wanted logs have been found, but the following logs exist:\n#{act}',
        logTemplate,
        fnErr ? fnErr.logs.slice(0) : foundLog
    );
  });

};

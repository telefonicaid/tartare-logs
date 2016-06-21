# RELEASE NOTES

## v1.0.0 / 21 Jun 2016
* Ignore fields with `undefined` value when using the RegExp parsing method and some capture group matches nothing.

## v0.5.0 / 22 Jul 2015
* JSON logs can be validated against a JSON Schema.
* Templates passed to `LogReader.waitForLogToExist` now accept regexps against any data type and the `undefined` value.  

## v0.4.0 / 10 Jul 2015
* Added support for reading logs in JSON format.
* Changed the way `LogWatcher` and `LogReader` are configured, due to the extra parsing method added
  (breaks backwards compatibility).
* `LogReader.waitForLogsToExist` is renamed as `waitForLogToExist` (singular).

## v0.3.0 / 29 Apr 2015
* Allow a polling strategy for filesystems where listening to file changes is not reliable or does not work at all.
* `LogWatcher` accepts a function as `pattern` parameter.
* Two new methods have been added to the `LogReader` class: `getLogs` and `getErrors`.
* `LogReader.waitForLogsToExist` now accepts an options object as second parameter that can convey the timeout
  and a new flag called `strict` that makes the function to fail if the first found log does not match the given 
  template. Note that this change breaks backward compatibility.

## v0.2.0 / 19 Mar 2015
* Added support for reading logs from a stream (such as stdout/stderr).

## v0.1.2 / 27 Feb 2015
* Support reading slowly written multi-line logs, by retaining logs that are apparently complete (they match the
  given pattern) but could be completed by upcoming log lines.

## v0.1.1 / 20 Feb 2015
* Avoid reading already read data (sometimes the underlying watcher reports wrong stats, overlapping ranges).
* Support reading logs whose lines are not completely written at the time the watcher reports a change in the file.

## v0.1.0 / 13 Feb 2015
* `LogWatcher` class watches a log file to read new logged entries and, optionally parse each entry according to a
  given pattern. This class emits events with the parsed log entries.
* `LogReader` is a helper class that uses `LogWatcher` to watch log files, internally storing new log entries, and 
  provides a method that wait for the existence of a log entry that matches a given template.
* The `resilience` module provides a set of functions that allow to test the behaviour of a SUT when logging
  under unfavorable conditions.
   

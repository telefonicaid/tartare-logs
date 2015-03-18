# RELEASE NOTES

## v0.2.0 / XXX
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
   
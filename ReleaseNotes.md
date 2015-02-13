# RELEASE NOTES

## v0.1.0 / 13 Feb 2015
* `LogWatcher` class watches a log file to read new logged entries and, optionally parse each entry according to a
  given pattern. This class emits events with the parsed log entries.
* `LogReader` is a helper class that uses `LogWatcher` to watch log files, internally storing new log entries, and 
  provides a method that wait for the existence of a log entry that matches a given template.
* The `resilience` module provides a set of functions that allow to test the behaviour of a SUT when logging
  under unfavorable conditions.
   
# tartare-logs

**The Tartare family:**
[tartare](https://github.com/telefonicaid/tartare/) |
[tartare-chai](https://github.com/telefonicaid/tartare-chai/) |
[tartare-mock](https://github.com/telefonicaid/tartare-mock/) |
[tartare-util](https://github.com/telefonicaid/tartare-util/) |
[tartare-collections](https://github.com/telefonicaid/tartare-collections/)

---

A set of utilities that help you out in testing logs produced by the [SUT](http://en.wikipedia.org/wiki/System_under_test).

This module includes:
- LogWatcher: An EventEmitter that watches a log file or listen to a stream (such as the stdout), parsing the logs
    accordingly to a given rule, and emits events for the parsed log entries. 
- LogReader: A class that uses the LogWatcher to read and store log entries, and allows you to wait for the 
    presence of a log entry that matches a given template.
- A [Chai](http://chaijs.com/) plugin to assert the presence or absence of a log.
- A set of functions to test resilience issues related to a log file.


#LogWatcher
Logs are usually written to a file or printed through the console (using the stdout or the stderr), and follow
some kind of pattern, such as fields separated by some character, a JSON document, etc. 

This class is an EventEmitter that watches a log file (detecting new logs written by the SUT) or listen to a stream
(such as the stdout or stderr streams from the [ChildProcess](https://nodejs.org/api/child_process.html#child_process_class_childprocess) class),
parsing each new log entry accordingly to the configured method (see below), and emits `log` events that conveys
an object with the parsed log. It also emit `error` events when an error happen.

LogWatcher supports the following parsing methods:
- **RegExp**: Each log entry is matched against a regular expression that contains capturing groups. Then the object
    with the parsed data is built using the captured data as field values whose names are taken from the array
    passed in the configuration.
- **JSON**: Each log entry is considered a JSON document, and will be parsed as such.
- **Custom**: Each log entry is passed to a custom function that receives a string with the log entry and returns the
    object with the parsed data, or null if the log entry cannot be parsed.


You can create a LogWatcher instance using any of these two ways:

```javascript
var LogWatcher = require('tartare-logs').LogWatcher;
var logWatcher = new LogWatcher(source, config);
```

```javascript
var tartareLogs = require('tartare-logs');
var logWatcher = tartareLogs.watchLog(source, config);
```

where `source` can be a String with the path to the log file or a Stream, and `config` is an object whose properties
depend on the method to be used to parse each log entry:
- RegExp method: set these two properties in the `config` object:
    - `pattern`: the regular expression containing capturing groups that will be matched against each log entry.
    - `fieldNames`: an Array of strings with the names of each captured value, in the same order than the capturing
        groups are in the regular expression.
- JSON method: set a `json` property with a truthy value in the `config` object.
- Custom method: set a `fn` property in the `config` file whose value is a function that will be called each time
    a new log entry is detected. This function receives a string with the log entry as argument and must return
    an object with the parsed data, or null if it fails to parse the log entry.

  
Moreover, LogWatcher has a couple of methods to start and stop watching logs:

```javascript
logWatcher.start();

logWatcher.on('log', function(log) {
});
logWatcher.on('error', function(err) {
});

logWatcher.stop();
```

## Examples
Watching a log file where each log entry is something like `time=2015-06-18T11:47:46.983Z | msg=Lorem ipsum | foo=3`:
```javascript
var logWatcher = tartareLogs.watchLog('./logs/sut.log', {
  pattern: /^time=(\d{4}\-\d{2}\-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \| msg=(.+) \| foo=(\d+)$/,
  fieldNames: [time, msg, foo]
});
logWatcher.start();
logWatcher.on('log', function(log) {
  console.log(log); // ==> {time: '2015-06-18T11:47:46.983Z', msg: 'Lorem ipsum', foo: '3'}
});
```

Watching the stdout when each log entry is a JSON document like `{"time": "2015-06-18T11:47:46.983Z", "msg": "Lorem ipsum", "foo": 3}`:
```javascript
var logWatcher = tartareLogs.watchLog('./logs/sut.log', {json: true});
logWatcher.start();
logWatcher.on('log', function(log) {
  console.log(log); // ==> {time: '2015-06-18T11:47:46.983Z', msg: 'Lorem ipsum', foo: 3}
});
```

## Customizing the LogWatcher
When creating a new LogWatcher instance, you can pass an object after the `config` parameter with different options
that customize its behaviour:
- `autoStart`: If true, the log watcher will start watching the log file or listening to the stream immediately,
    without the need of invoking the `start` method.
- `polling`: If true, the log watcher will prefer a polling strategy instead of listening to filesystem
    events (useful for filesystems where watching is not reliable, or does not work at all, such as network
    filesystems). Polling interval is set using the `interval` option.
- `interval`: If `polling` is true, this is the interval (in ms) used to poll the log file (Defaults to 100ms).
- `allowPatternViolations` (defaults to false): When using the RegExp method and this property is set to
    true, if a log entry does not match the pattern, it will be added to the previous log entry
    (useful to support logs with stacktraces, config object, and any other kind of dump). If this
    property is set to false, an 'error' event will be emitted if the log entry does not match the regular expression.
- `retainedLogTimeout` (defaults to 300): Timeout (in ms) to emit a log that has been retained
    just in case it were not a complete log (because the last change in the log file or the stream
    could be part of this log). Only valid for the RegExp method.

The last option refers to a retention policy applied by the LogWatcher when using the RegExp method. Some SUTs
write multiline logs to include a stracktrace (or whatever) as part of the last field. LogWatcher is able to deal
with these multiline logs but it cannot know when the log is complete. Then, in order to avoid emitting an incomplete
log event, it retains the last read log (just in case it is going to be completed by incoming log lines) until the
next log entry is detected, or until a timeout expires, which is the one set with the `retainedLogTimeout` option.

# LogReader
This is a helper class that uses the LogWatcher for listening to `log` events and stores them. Then you can ask the
LogReader if the log you are expecting has already been emitted, and if not, it wait until the log is emitted, or
a timeout expires. In this way you can ask for a log at any time, regardless of whether it has already emitted or it
is about to be emitted.

You can get a new instance of the LogReader in any of the following two ways:

```javascript
var LogReader = require('tartare-logs').LogReader;
var logReader = new LogReader(source, config, opts);
```

```javascript
var tartareLogs = require('tartare-logs');
var logReader = tartareLogs.createLogReader(source, config, opts);
```

where `source`, `config` and `opts` are directly passed to the underlying LogWatcher.

The LogReader implements the following methods:
- `start()`: start the LogWatcher and begin to store logs. 
- `stop()`: stop the LogWatcher.
- `waitForLogToExist(template, opts, cb)`: wait until a log matching the given template is emitted from
    the LogWatcher. If the matching log has already been emitted when this method is called, or the log
    arrives before a given timeout, the callback function is invoked with the found log as the second argument.
    If an error happens or no logs are found that match the template, the callback function is invoked with the error.
    The `template` is an object whose field names are the field names to search in the log, and whose values are
    the expected values or regular expressions against which the log value will be matched.
    The `opt` argument (optional) is an object with the following allowed options:
      - `timeout` (defaults to 3000ms): time (in ms) after which the callback function will be invoked with an
          error if no logs match the template.
      - `strict` (defaults to `false`): If true, the callback function is invoked with an error if the first
          emitted log does not match the template. If false, this method waits for some log to match the template
          until the timeout expires.
- `getLogs()`: return the stored log until that moment.
- `getErrors()`: return the errors returned by the LogWatcher until that moment.
    
The following is an example of how to use the LogReader to wait for a SUT to write a log entry with a given pattern:
```javascript
logReader.start();

// Perform some action that makes your SUT to log something

var logTemplate = {
  msg: /^Lorem/,
  foo: 3
};
logReader.waitForLogToExist(logTemplate, {timeout: 500}, function(err, foundLog) {
  if (err) {
    console.error('Error: ', err);  
  } else {
    console.log('Found Log:', foundLog);
  }
  logReader.stop();
});
```

# Chai Plugin
tartare-logs include a [Chai](http://chaijs.com/) plugin that allows you to make assertions around the
`waitForLogToExist` method of the LogReader. Basically the plugin asserts that, after invoking such a method
with the given arguments, its callback is not invoked with an error stating that no logs matched the template.
At the end, the plugin is asserting that a log matching the template has been found.

```javascript
var chai = require('chai');
var expect = chai.expect;
var tartareLogs = require('tartare-logs');
chai.use(tartareLogs.chai);

var logReader = tartareLogs.createLogReader(source, config, opts);

logReader.start();

// Perform some action that makes your SUT to log something

var logTemplate = {
  msg: /^Lorem/,
  foo: 3
};
expect(logReader.waitForLogToExist).to.not.throwLogNotFoundError(logTemplate, {timeout: 500});

logReader.stop();
```

The arguments passed to the assertion are directly passed to the `waitForLogToExist` method.

When using tartare-logs with the [Tartare framework](https://github.com/telefonicaid/tartare/), it would look like this:
```javascript
var chai = require('chai');
var expect = chai.expect;
var tartareLogs = require('tartare-logs');
chai.use(tartareLogs.chai);

var logReader = tartareLogs.createLogReader(source, config, opts);

feature('Addition', function() {
  scenario('Add two natural numbers', function() {
    given('I have entered 50 into the calculator', function() {
      steps.enterNumber(50);
    });
    and('I have entered 70 into the calculator', function() {
      steps.enterNumber(70);
    });
    when('I press add', function() {
      logReader.start();
      steps.add();
    });
    then('the SUT has logged the operation', function() {
      var logTemplate = {
        op: 'add',
        msg: 'Numbers 50 and 70 have been added, resulting 120'
      };
      expect(logReader.waitForLogToExist).to.not.throwLogNotFoundError(logTemplate, {timeout: 500});
      logReader.stop();
    });
  });
});
```

# Log resilience
When the SUT is logging to a file, there are several tests than may be carried out in order to check how the SUT
behaves when problems with the log file happen. The following is a list of functions availables in the `resilience`
submodule (`require('tartare-logs').resilience`):

- `doesLogFileExist(logFile, cb)`: Check whether the given log file exists or not. 
- `getLogFileSize(logFile, cb)`: Get the size of the given log file (in bytes). 
- `rotateLogFile(logFile, cb)`: Simulate a log file rotation by truncating the given file. 
- `removeLogFile(logFile, cb)`: Remove the given log file. If the file does not exist, there are not any error. 
- `createReadOnlyDir(path, cb)`: Create a read-only directory, so the SUT won't be able to write logs to it. 
- `removeDir(path, cb)`: Remove the given directory and all its content. 
- `createLogFS(path, size, cb)`: Create a temporally file system with the given size using
    [tmpfs](https://en.wikipedia.org/wiki/Tmpfs), that can be used to check how the SUT behaves when the partition
    where it is logging gets full. It only works on Linux. 
- `removeLogFS(path, cb)`: Remove the temporally file system created with the former function. 
- `removeWritePermissionFromLogFile(logFile, cb)`: Remove write permissions to an existing file. 
- `addWritePermissionToLogFile(logFile, cb)`: Add write permissions to an existing file.


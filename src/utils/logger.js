const PREFIX = {
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
  debug: '[DEBUG]',
};

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info(source, msg) {
    console.log(`${timestamp()} ${PREFIX.info} [${source}] ${msg}`);
  },
  warn(source, msg) {
    console.warn(`${timestamp()} ${PREFIX.warn} [${source}] ${msg}`);
  },
  error(source, msg, err) {
    console.error(`${timestamp()} ${PREFIX.error} [${source}] ${msg}${err ? ': ' + err.message : ''}`);
  },
  debug(source, msg) {
    if (process.env.DEBUG) {
      console.log(`${timestamp()} ${PREFIX.debug} [${source}] ${msg}`);
    }
  },
};

module.exports = logger;

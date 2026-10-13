/**
 * Minimal Server-Sent Events helpers shared by the AI-service client
 * (parsing) and the query controller (writing).
 */

/** Incremental parser: feed text chunks, get back complete events. */
function createSseParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) {
        let parsed;
        try {
          parsed = JSON.parse(data.join('\n'));
        } catch {
          parsed = data.join('\n');
        }
        onEvent(event, parsed);
      }
      boundary = buffer.indexOf('\n\n');
    }
  };
}

function writeSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

module.exports = { createSseParser, writeSse };

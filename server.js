const os = require('os');
const fs = require('fs');
//const spawn = require('child_process').spawn;
const pty = require('node-pty');
const mime = require('mime');
const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('/'))
app.use(cors());

process.on('warning', e => console.warn(e.stack));

let cli = spawnInstance('bash');
//cli('echo $PWD'); // TODO throw if this cause errors
//const SIGINT = Symbol('SIGINT');

let socket;

function spawnInstance(path) {
  const child = pty.spawn(path, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env
  });

  child.on('data', data => {
    console.log('sending chunk', JSON.stringify(data));
    if (socket) socket.emit('consoleout', { data: JSON.stringify(data) });
  });

  return (command) => {
    child.write(`${command} && echo ___PWD=$PWD && echo ___RETURNCODE=$?\n`); // add & to force run in bg and avoid interactive apps? lastline contains pid
  };
}

async function executeBashCmd(command, forceUSLocale = true) {
    try {
      return await cli((forceUSLocale ? 'LC_ALL=en_US.utf8 ' : '') + command);
    } catch (error) {
      return { response: error, returncode: 1, pwd: null };
    }
}

app.get('/bash', async function(request, response) {
  const message = { start: +new Date() };
  executeBashCmd(decodeURI(request.query.cmd));
  /* if (request.query.cmd) {
    processBashRequest(request, response, message);
  } else if (request.query.autocomplete) {
    //message.response = await executeBashCmd(decodeURI(request.query.autocomplete), false)
    //response.send(response);
  } else if (request.query.kill) {

  } */
  response.send({ ...message });
});

app.get('/stats', function(request, response) {
  const message = { start: +new Date() };
  const stats = require('systeminformation');
  stats.osInfo()
      .then(data => response.send({ ...message, out: { ...data, userInfo: os.userInfo() } }))
      .catch(error => console.error({ ...message, error: error }));
});

function listFiles(path) {
    try {
        let files = fs.readdirSync(path).map(filename => ({ path, filename, fullpath: path + '/' + filename }));
        if (files.length < 10000) {
          files = files.map(file => {
            try {
              file.mime = mime.lookup(file.fullpath);
              file.stats = fs.statSync(file.fullpath);
            } catch (error) {
              file.stats = {};
              file.unavailable = true;
            }
            return file;
          });
        }

        return files;
    } catch (error) {
        return null;
    }
}

app.get('/files', function(request, response) {
  const message = { start: +new Date() };
  const path = decodeURI(request.query.path || '');

  const cmd = request.query.cmd in ['list', 'move', 'copy', 'delete', 'touch'] ? request.query.cmd : 'list';

  if (cmd == 'list')  {
    return fs.stat(path, (error, stats) => {
      if (error) {
        return response.send({ ...message, error: error });
      }
      message.out = { stats };

      if (stats.isDirectory()) {
        message.out.isdir = true;
        message.out.files = listFiles(path);

      } else {
        message.out.mime = mime.lookup(path);
      }
      response.send(message);
    });
  }
});

app.get('/typeof', async function (request, response) {
  const message = { start: +new Date() };
  const path = decodeURI(request.query.path || '');

  const type = await executeBashCmd('file -i ' + path);
  message.out = type;
  response.send(message);
});

io.on('connection', sock => {
  socket = sock;
  console.log('socket connection from', sock.client.conn.remoteAddress);
  sock.emit('connected');
});

http.listen(1337);

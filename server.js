const os = require('os');
const fs = require('fs');
const spawn = require('child_process').spawn;
const mime = require('mime');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.static('/'))
app.use(cors());

process.on('warning', e => console.warn(e.stack));

function spawnInstance (path) { // https://github.com/nodejs/help/issues/1183?s_tact=C209148W#issuecomment-376414424
  const c = spawn(path);
  return (command, literal = false) => {
    return new Promise((resolve, reject) => {
      var buf = Buffer.alloc(0);
      c.stdout.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        resolve(String(buf));
      })
      c.stderr.on('data', d => {
        buf = Buffer.concat([buf, d]);
        reject(String(buf));
      });
      c.stdin.write(literal ? command : `${command} && echo PWD=$PWD && echo ERRORCODE=$?\n`);
    })
  }
}

async function executeBashCmd(command, forceLiteral = false, forceUSLocale = true) {
    try {
        if (forceLiteral) {
            return { response: await cli(command, true), returncode: 0 };
        } else {
            const result = await cli((forceUSLocale ? 'LC_ALL=en_US.utf8 ' : '') + command);
            const matches = result.match(/(?:^|\n)PWD=([^\n]+)\nERRORCODE=([0-9]+)\n*$/);
            const response = result.replace(/(?:^|\n)PWD=([^\n]+)\nERRORCODE=([0-9]+)\n*$/, '');
            return { response, returncode: matches ? matches[2] : -1, pwd: matches ? matches[1] : null };
        }
    } catch (error) {
        return { response: error, returncode: -1, pwd: null };
    }
}

const cli = spawnInstance('bash');

async function processBashRequest(request, response, message) {
  let result = await executeBashCmd(decodeURI(request.query.cmd));

  if (result.returncode * 1 > 0) {
    message.error = result.response;
    message.pwd = result.pwd;
  } else {
    message.out = result.response;
    message.pwd = result.pwd;
  }
  message.end = +new Date();
  response.send(message);
}

app.get('/bash', async function(request, response) {
  const message = { start: +new Date() };

  if (request.query && request.query.autocomplete) {
      const partial = decodeURI(request.query.autocomplete);
      //const result = await executeBashCmd(`echo ${partial}$'\\t'$'\\t' | bash -i 2>&1 | head -n -4 | tail -n +2\n`, true);
      const result = await executeBashCmd(`echo ${partial}$'\\t'$'\\t' | bash -i 2>&1 | tail -n +2\n`, true);

      if (!result.response.match(/(Display all \d+ possibilities|not found, did you mean)/)) {
          const list = result.response
            .split(/[^\n]+:/)[0]
            .split(/[ \n]+/)
            .map(s => s.trim())
            .filter(s => s && s != partial)
            .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

          message.out = { response: list, returncode: result.returncode };
      } else {
          message.out = { response: [], returncode: -1 };
      }
      response.send(message);

    } else if (request.query && request.query.cmd) {
        if (request.query.cmd.match(/^sudo/)) {
          console.log('Received SUDO command', decodeURI(request.query.cmd));

          const sudo = spawn('sudo', ['-S', 'ls']);

            sudo.stderr.on('data', async function (data) {

              console.log('Requesting sudo password', 'Answering:', decodeURI(request.query.password));
              sudo.stdin.write(decodeURI(request.query.password) + '\n');
              processBashRequest(request, response, message);
            });

            sudo.stdout.on('data', async function (data) {
              processBashRequest(request, response, message);
            });

      } else {
          console.log('Received command', decodeURI(request.query.cmd));
          processBashRequest(request, response, message);
      }
  } else {
      message.error = 'Empty command';
      response.send(message);
  }
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

app.listen(1337);

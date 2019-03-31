const os = require('os');
const fs = require('fs');
const pty = require('node-pty');
const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { exec } = require('child_process');
const readChunk = require('read-chunk');
const fileType = require('file-type');
const thumbnail = require('thumbnail');
const md5File = require('md5-file');

app.use(express.static('/'))
app.use(cors());

process.on('warning', e => console.log(e.stack));

let cli = spawnInstance('bash');

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
    console.log('bash response', JSON.stringify(data));
    if (socket) socket.emit('console.out', data);
  });

  return string => {
    console.log('writing to bash', string);
    child.write(string);
  }
}

app.get('/files', function(request, response) {
  const message = { start: +new Date() };
  const path = decodeURI(request.query.path || process.env.HOME);
  const thumbroot = '/home/kreso/Projects/interface/cache/thumbnails';

  fs.stat(path, (error, stats) => {
    if (error) {
      return response.send({ ...message, error: error });
    }
    message.out = { stats };
    message.out.path = path;

    if (stats.isDirectory()) {
      message.out.isdir = true;
      try {
        let files = fs.readdirSync(path).map(filename => ({ path, filename, fullpath: path + '/' + filename }));
        if (files.length < 10000) {
          files = files.map(file => {
            try {
              file.stats = fs.statSync(file.fullpath);
              if (file.stats.isDirectory()) {
                file.mime = 'inode/directory';

              } else {
                const type = fileType(readChunk.sync(file.fullpath, 0, fileType.minimumBytes));
                file.mime = type && type.mime || 'text/plain';
              }

              if (file.mime.match(/(image|video)\//)) {
                const hash = md5File.sync(file.fullpath);
                file.thumbnail = `${thumbroot}/${hash}.jpg`;

                fs.exists(file.thumbnail, function(exists) {
                  if (!exists) {
                    if (file.mime.match(/image/)) {
                      exec(`gm convert -size 200x200 ${file.fullpath} -resize 200x200 +profile "*" ${thumbroot}/${hash}.jpg`); // TODO error handling
                    } else {
                      exec(`ffmpeg -i ${file.fullpath} -vcodec mjpeg -vframes 1 -an -vf scale=200:-1 -ss \`ffmpeg -i ${file.fullpath} 2>&1 | grep Duration | awk '{print $2}' | tr -d , | awk -F ':' '{print ($3+$2*60+$1*3600)/2}'\` ${thumbroot}/${hash}.jpg`);
                    }
                  }
                });

              }

            } catch (error) {
              console.log(error);
              file.stats = {};
              file.unavailable = true;
            }
            return file;
          });
        }

          message.out.files =  files;
      } catch (error) {
          message.out.files =  [];
      }

    } else {
      message.out.mime = mime.lookup(path);
    }
    response.send(message);
  });
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
  console.log('socket connection from', socket.client.conn.remoteAddress);
  socket.emit('connected');

  socket.on('bash', string => {
    //console.log('command', string)
    //executeBashCmd(command);
    cli(string);
  });
});

http.listen(1337);

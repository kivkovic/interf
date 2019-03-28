const os = require('os');
const fs = require('fs');
const spawn = require('child_process').spawn;
const mime = require('mime');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

function spawnInstance (path) { // https://github.com/nodejs/help/issues/1183?s_tact=C209148W#issuecomment-376414424
  const c = spawn(path);
  return command => {
    return new Promise((resolve, reject) => {
      var buf = Buffer.alloc(0);
      c.stdout.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        console.log('Command output', String(buf));
        if(buf.includes('ERRORCODE')) {
          resolve(String(buf));
        }
      })
      c.stderr.on('data', d => {
        console.log('Cli stderr handler', String(d));
        buf = Buffer.concat([buf, d]);
        reject(String(buf));
      })
      console.log('Executing', command);
      c.stdin.write(`${command} && echo PWD=$PWD && echo ERRORCODE=$?\n`);
      console.log('Executed');
    })
  }
}

async function executeBashCmd(command, forceUSLocale = true) {
    try {
        const result = await cli((forceUSLocale ? 'LC_ALL=en_US.utf8 ' : '') + command);
        const matches = result.match(/\nPWD=([^\n]+)\nERRORCODE=([0-9]+)\n*$/);
        const response = result.replace(/\nPWD=([^\n]+)\nERRORCODE=([0-9]+)\n*$/, '');
        return { response, returncode: matches ? matches[2] : -1, pwd: matches ? matches[1] : null };
    } catch (error) {
        return { response: error, returncode: -1, pwd: null };
    }
}

const cli = spawnInstance('bash');

async function processBashRequest(request, response, message) {
  let result = await executeBashCmd(decodeURI(request.query.cmd));

  if (result.returncode * 1) {
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
        if (files.length < 1000) {
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

	if (cmd == 'list')	{
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

app.get('/open', async function (request, response) {
	const message = { start: +new Date() };
	const path = decodeURI(request.query.path || '');
	
	fs.stat(path, async (error, stats) => {
		if (error) {
			return response.send({ ...message, error: error });
		}
		message.out = { stats };

		if (stats.isDirectory()) {
		    await executeBashCmd('cd ' + path);
		    const list = await executeBashCmd('ls -lhFa'); // listFiles(path); // todo replace later with listfiles, we get more info
		    message.out = list.response;
		    response.send(message);
		}
	});
});

app.listen(1337);

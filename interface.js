let user = {};

const server = 'http://192.168.5.14:1337/';

function initConsole(terminal, autocomplete) {
  terminal.classList.add('terminal');

  const location = document.createElement('span');
  let locationText = '';

  const input = document.createElement('input');
  input.className = 'input';
  input.className = 'terminal-input';
  input.value = '';
  input.style.display = 'none';
  terminal.appendChild(input);
  input.focus();

  let start = terminal.selectionStart;
  let disabled = false;
  let historycounter = 0;
  let currentPwd = '~';
  let waitingForCommand = false;
  let waitingForPassword = false;
  let waitingForCtrlEvent = false;
  let possiblyInteractive = false;
  let waitingForAutocomplete = false;
  let command = null;
  let lastResponse = null;
  let lineBuffer = [];
  const executedlines = [];
  const socket = io(server);

  socket.on('connected', data => {
    console.log('connected to socket.io on ' + server);
    waitingForCommand = true;
    setTimeout(() => socket.emit('bash', 'hello\n'), 500);
  });

  socket.on('console.out', data => {

    clearTimeout(lastResponse);
    lastResponse = setTimeout(() => {
      console.log('data from server', lineBuffer);

      if (waitingForAutocomplete || waitingForCtrlEvent) {

        let lines = [];
        autocomplete.innerHTML = '';

        if (waitingForAutocomplete) {
          lines = lineBuffer[1].split(/\s+/)
            .filter(line => line)
            .filter((line, i, lines) => {
              if (!i) {
                return !line.match(/^\x1B]0;.+:$/);
              }
              if (lines.length == 2 && i == 1) {
                return !line.match(/~\x07\x1B\[.+\[00m[#$]$/);
              }
              return line;
          });

        } else if (waitingForCtrlEvent) {
          if (lineBuffer.join('').match(/\(reverse-i-search\)/)) {
            lineBuffer = [];
            return;
          }
          lines = lineBuffer.map(line => line.replace(/^.+?':\s*/, '').replace(/\x1b\[C\x1B\[.*$/, ''));
        }

        waitingForAutocomplete = false;

        if (lines.length) {
          lines.map(entry => {
            const option = document.createElement('option');
            option.value = option.innerText = entry;
            autocomplete.appendChild(option);
          });

          autocomplete.size = Math.min(8, lines.length);
          autocomplete.style.display = 'block';
          autocomplete.style.top = (input.offsetTop + input.offsetHeight + 2) + 'px';
          autocomplete.style.left = input.offsetLeft + 'px';
          autocomplete.selectedIndex = 0;
          autocomplete.focus();
        }

      } else {

        if (!lineBuffer.length) {
          debugger; // should be unreachable

        } else if ((lineBuffer[0] + lineBuffer[1]).match(/(\[sudo\] password for|Sorry, try again)/i)) {
          waitingForPassword = true;
          createNewLine('password');

        } else {
          possiblyInteractive = false;

          const response = lineBuffer
            .join('\r\n').split('\r\n') // realigns line endings, because the way bash output is chunked is random
            .filter((line, i, lines) => {
              if (line.match(/(\?1h\x1B|\x1B\[\?1h)/)) {
                possiblyInteractive = true;
                return false;
              }
              if (i == lines.length - 1) {
                locationText = bashColors(line.replace(/^.+?\x07/, ''));
              }
              // 1) skip empty lines and \uffe3 (response from ctrl commands)
              // 2) if a command was pushed, it's echoed back in the first line of the response, so skip it (could be used to replace current input)
              // 3) last line is input line prefix
              return line.length && line != '\uffe3' && (i != 0 || !waitingForCommand) && i != lines.length - 1;
            });

          appendResponse(response.join('\n'));
        }

        waitingForCommand = false;
      }

      lineBuffer = [];
      disabled = false;
    }, 600);

    lineBuffer.push(data);
  });

  function createNewLine(type = 'normal') {
    terminal.appendChild(document.createElement('br'));
    const clone = location.cloneNode(true);

    if (type != 'password') {
      clone.innerHTML = locationText;
      input.classList.remove('password');

    } else {
      const last = getLastChild(terminal);
      const parent = last.parentNode;
      parent.replaceChild(document.createTextNode(input.value), last);
      parent.appendChild(last);
      clone.innerHTML = `<span class="sudo">Password:</span>&nbsp;`;
      waitingForPassword = true;
      input.value = '';
      input.classList.add('password');
    }

    terminal.appendChild(clone);
    terminal.appendChild(input);
    //debugger;
    input.style.width = `calc(100% - ${clone.innerText.length * 9.4 + 10}px)`;
    input.style.display = '';
    input.focus();
    terminal.scrollTop = terminal.scrollHeight;
  }

  function appendResponse(string) {
    const clone = input.cloneNode(true);
    clone.readOnly = 'readonly';
    terminal.replaceChild(clone, input);
    input.value = '';

    const response = document.createElement('div');
    response.style.cssText = 'white-space: pre;';
    response.className = 'stdout';
    response.tabIndex = '0';
    response.innerHTML = bashColors(string);
    terminal.appendChild(response);

    createNewLine();
  }

  function executeInput() {
    executedlines.push(input.value);
    historycounter = executedlines.length;

    const command = input.value + (possiblyInteractive ? '' : '\n');
    console.log('sending command', command);
    socket.emit('bash', command);

    disabled = true;
    waitingForCommand = true;
    waitingForPassword = false;
  }

  terminal.onfocus = function () {
    input.focus();
  }

  terminal.onkeydown = function (event) {

    if (event.ctrlKey && event.key != 'Control') { // ctrl + letter combos
      event.stopPropagation();
      event.preventDefault();

      socket.emit('bash', String.fromCharCode(event.key.charCodeAt(0) - 96));
      if (event.key == 'c') {
        waitingForCtrlEvent = false;
      } else if (event.key == 'r') {
        waitingForCtrlEvent = true;
        input.onkeydown = event => {
          if (event.key == 'Enter') debugger;
          const key = event.key.length == 1 ? event.key : String.fromCharCode(event.keyCode);
          socket.emit('bash', key);
        }
      }

      return false;
    }

    if (disabled) {
      event.preventDefault();
      return false;
    }

    const text = input.value.replace(/\u00a0/g, ' ');

    if (event.key == 'Enter') {
      if (text.length) {
        executeInput();
      } else {
        createNewLine();
      }
      event.preventDefault();
      return false;

    } else if (event.key == 'ArrowUp') {

      if (executedlines.length) {
        historycounter = historycounter > 0 ? --historycounter : executedlines.length - 1;
        input.value = executedlines[historycounter];
        input.focus();
      }
      event.preventDefault();
      return false;

    } else if (event.key == 'ArrowDown') {
      if (executedlines.length) {
        historycounter = (historycounter + 1) % executedlines.length;
        input.value = executedlines[historycounter];
        input.focus();
      }
      event.preventDefault();
      return false;

    } else if (event.key == 'Tab') {
      waitingForAutocomplete = true;
      socket.emit('bash', `echo ${text.trim()}$'\\t'$'\\t' | bash -i 2>&1 | head -n -4 | tail -n +2\n`);
      event.preventDefault();
      return false;

    }
  }

  autocomplete.onkeydown = event => {
    if (event.key == 'Enter' || event.key == ' ' || event.key == 'Escape' || event.key == 'Tab' || event.key == 'Backspace') {
      if (event.key == 'Backspace') {
        input.value = input.value.slice(0, -1);
      } else if (event.key != 'Escape') {
        if (input.value.match(/(\u00a0| )$/)) {
          input.value += autocomplete.value;
        } else {
          input.value = autocomplete.value;
        }
      }

      autocomplete.style.display = 'none';
      input.focus();
      event.preventDefault();
      return false;
    }
  };

}

function handleFileOpen(file, type) {

  const display = document.querySelector('#display');
  const editor = document.querySelector('#text-editor');
  display.parentNode.style.display = 'none';
  editor.style.display = 'none';

  const embed = document.createElement('embed');
  embed.type = type;
  embed.src = 'http://192.168.5.14:1337/' + file;

  if (type.match(/^text/)) {
    embed.style.minWidth = '100%';
    embed.style.minHeight = '50vh';
    editor.innerHTML = '';
    editor.appendChild(embed);
    editor.style.display = 'block';

  } else {

    if (type.match(/^video/)) {
      embed.style.width = '100%';
      embed.style.height = '100%';
    } else {
      embed.style.minWidth = '100%';
      embed.style.minHeight = '50vh';
    }

    display.innerHTML = '';
    display.appendChild(embed);
    display.parentNode.style.display = 'block';
  }
}

function getLastChild(element) {
  let lastChild = element.lastChild;
  while (lastChild && lastChild.nodeType != 1) {
    if (lastChild.previousSibling) {
      lastChild = lastChild.previousSibling;
    } else {
      break;
    }
  }
  return lastChild;
}

function canContainText(node) {
  if (node.nodeType == 1) {
    return !['BR', 'IMG', 'INPUT', 'LABEL', 'DIV', 'SPAN', 'STRONG'].indexOf(node.nodeName) != -1;
  }
  return false;
}

function bashColors(string) {
  return (string
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // html escape
    .replace(/\x1B\[([0-9;]+|J|K|#)?m?/g, (matches, font) => {
      if (!font || font == '0') return '</span>';
      if (font.match(/[JK#]/)) return '<br/>';

      let style = '';
      if (font.match(/\b0?0?1\b/)) style += 'font-weight: 500;';
      if (font.match(/\b0?30\b/)) style += 'color: black;';
      if (font.match(/\b0?31\b/)) style += 'color: crimson;';
      if (font.match(/\b0?32\b/)) style += 'color: green;';
      if (font.match(/\b0?33\b/)) style += 'color: gold;';
      if (font.match(/\b0?34\b/)) style += 'color: cornflowerblue;';
      if (font.match(/\b0?35\b/)) style += 'color: mediumorchid;';
      if (font.match(/\b0?36\b/)) style += 'color: darkcyan;';
      if (font.match(/\b0?37\b/)) style += 'color: lightgray;';
      if (font.match(/\b0?90\b/)) style += 'color: darkgray;';
      if (font.match(/\b0?91\b/)) style += 'color: red;';
      if (font.match(/\b0?92\b/)) style += 'color: lime;';
      if (font.match(/\b0?93\b/)) style += 'color: yellow;';
      if (font.match(/\b0?94\b/)) style += 'color: deepskyblue;';
      if (font.match(/\b0?95\b/)) style += 'color: magenta;';
      if (font.match(/\b0?96\b/)) style += 'color: cyan;';
      if (font.match(/\b0?97\b/)) style += 'color: white;';
      if (font.match(/\b0?40\b/)) style += 'background: black;';
      if (font.match(/\b0?41\b/)) style += 'background: crimson;';
      if (font.match(/\b0?42\b/)) style += 'background: green;';
      if (font.match(/\b0?43\b/)) style += 'background: gold;';
      if (font.match(/\b0?44\b/)) style += 'background: cornflowerblue;';
      if (font.match(/\b0?45\b/)) style += 'background: mediumorchid;';
      if (font.match(/\b0?46\b/)) style += 'background: darkcyan;';
      if (font.match(/\b0?47\b/)) style += 'background: lightgray;';
      if (font.match(/\b100\b/)) style += 'background: darkgray;';
      if (font.match(/\b101\b/)) style += 'background: red;';
      if (font.match(/\b102\b/)) style += 'background: lime;';
      if (font.match(/\b103\b/)) style += 'background: yellow;';
      if (font.match(/\b104\b/)) style += 'background: deepskyblue;';
      if (font.match(/\b105\b/)) style += 'background: magenta;';
      if (font.match(/\b106\b/)) style += 'background: cyan;';
      if (font.match(/\b107\b/)) style += 'background: white;';

      return `<span style="${style}">`;
    }))
    .replace(/\x1B\[?./g, '');
}

function initNavigator(filenavigator, contextmenu) {

  loadPath('');

  function createCell(contents, className = '') {
    const cell = document.createElement('div');
    cell.className = 'cell ' + className;
    typeof contents == 'string' && (cell.innerHTML = contents);
    typeof contents == 'object' && (cell.appendChild(contents));
    return cell;
  }

  function createControl(title, icon, onclick, css) {
    const control = document.createElement('div');
    control.title = title;
    control.className = 'control';
    control.innerHTML = `<i class="${icon}" style="${css}"></i>`;
    control.onclick = onclick;
    return control;
  }

  function createContextControl(text, icon, onclick, css, raw = null) {
    if (text == false) {
      const separator = document.createElement('li');
      separator.className = 'separator';
      return separator;
    }
    const control = document.createElement('li');
    control.innerHTML = raw != null ? raw : `<i class="${icon}" style="${css}"></i>${text.replace(/^./, m => m.toUpperCase())}`;
    control.onclick = onclick;
    return control;
  }

  function loadPath(path) {
    fetch(server + 'files/?path=' + (path || ''))
    .then(data => data.json())
    .then(data => {
      if (!data.out || !data.out.path) {
        return;
      }

      filenavigator.style.display = 'block';
      filenavigator.innerHTML = '';

      const navlocation = document.createElement('input');
      navlocation.className = 'navlocation';
      navlocation.value = data.out.path;
      navlocation.onkeydown = event => event.key == 'Enter' ? loadPath(navlocation.value) : true;
      filenavigator.appendChild(navlocation);

      const table = document.createElement('div');
      table.className = 'table';

      const rows = [];

      let dragging = false, selection = [], copyClipboard = [], cutClipboard = [], holdingCtrl = false;
      filenavigator.onmousedown = (event) => {
        return (
          holdingCtrl ||
          event.target.classList.contains('control') ||
          event.target.parentNode.classList.contains('control') ||
          (dragging = true, selection = [], rows.map(r => r.classList.remove('selected')))
        );
      };
      filenavigator.onmouseup = () => dragging = false;
      filenavigator.onkeydown = event => (event.ctrlKey && (holdingCtrl = true), true);
      filenavigator.onkeyup = event => (holdingCtrl = false, true);

      const parent = data.out.path.split('/').slice(0, -1).join('/');
      if (parent) {
        const row = document.createElement('div');
        row.className = 'row';
        const uplink = document.createElement('span');
        uplink.innerText = '..';
        uplink.style.cursor = 'pointer';
        uplink.onclick = () => loadPath(parent);
        row.appendChild(createCell(createIcon({ mime: 'inode/directory' })));
        row.appendChild(createCell(uplink, 'file'));
        row.appendChild(createCell('Folder'));
        row.appendChild(createCell(''));
        row.appendChild(createCell(''));
        table.appendChild(row);
      }

      const navup = () => loadPath(parent);
      const home = () => loadPath('');
      const cut = () => (cutClipboard = cutClipboard.concat(selection), copyClipboard = [], selection = []);
      const copy = () => (copyClipboard = copyClipboard.concat(selection), cutClipboard = [], selection = []);
      const paste = () => console.log('RENAME', selection);
      const rename = () => console.log('DELETE', selection);
      const del = () => console.log('ARCHIVE', selection);
      const archive = () => console.log('SEND', selection);
      const send = () => console.log('TERMINAL HERE', selection);
      const terminalhere = () => {
        if (copyClipboard.length) console.log('copy-pasting', copyClipboard);
        if (cutClipboard.length) console.log('cut-pasting', cutClipboard);
        copyClipboard = [];
        cutClipboard = [];
        rows.map(r => r.classList.remove('selected'));
      };
      const focusSearchInput = () => console.log('focusSearchInput');
      const newfolder = () => console.log('newfolder');
      const newfile  = () => console.log('newfile ');
      const toggleHidden = () => {
        Array.from(table.querySelectorAll('.hidden')).map(row => row.style.display = (row.style.display != 'table-row' ? 'table-row' : 'none'));
      };

      const controls = document.createElement('div');
      controls.className = 'controls';

      contextmenu.innerHTML = '';
      contextmenu.className = 'contextmenu';

      table.onclick = (e) => contextmenu.style.height = '0';

      contextmenu.append(createContextControl('search', 'fas fa-search', focusSearchInput));
      contextmenu.append(createContextControl(false));
      contextmenu.append(createContextControl('new folder', 'fas fa-folder-plus', newfolder));
      contextmenu.append(createContextControl('new file', 'fas fa-file-medical', newfile));
      contextmenu.append(createContextControl(false));

      for (let def of [{ ref: controls, fn: createControl }, { ref: contextmenu, fn: createContextControl }]) {
        def.ref.append(def.fn('navigate up', 'fas fa-chevron-up', navup));
        def.ref.append(def.fn('home', 'fas fa-home', home));
        def.ref.append(def.fn('terminal here', 'fas fa-terminal', terminalhere, 'font-size: 16px; line-height: 19px;'));
        if (def.ref == contextmenu) contextmenu.append(createContextControl(false));
        def.ref.append(def.fn('cut', 'fas fa-cut', cut));
        def.ref.append(def.fn('copy', 'fas fa-copy', copy));
        def.ref.append(def.fn('paste', 'fas fa-paste', paste));
        def.ref.append(def.fn('delete', 'fas fa-trash', del));
        if (def.ref == contextmenu) contextmenu.append(createContextControl(false));
        def.ref.append(def.fn('rename', 'fas fa-i-cursor', rename));
        if (def.ref == contextmenu) def.ref.append(def.fn('archive', '', archive, null, '<svg><use xlink:href="#archive" /></svg>Archive'));
        if (def.ref == contextmenu) def.ref.append(def.fn('unarchive', '', archive, null, '<svg><use xlink:href="#unarchive" /></svg>Unarchive'));
        def.ref.append(def.fn('send', 'fas fa-paper-plane', send));
        if (def.ref == contextmenu) contextmenu.append(createContextControl(false));
        def.ref.append(def.fn('show hidden files', 'fas fa-eye-slash', toggleHidden));
      }

      filenavigator.append(controls);

      data.out.files
      .sort((a, b) => {
        if (a.mime.match(/directory/) && !b.mime.match(/directory/)) return -1;
        return a.filename > b.filename ? 1 : a.filename < b.filename ? -1 : 0;
      })
      .map(file => {
        const row = document.createElement('div');
        row.className = 'row';
        const filelink = document.createElement('span');
        filelink.innerHTML = file.filename;
        filelink.style.cursor = 'pointer';
        if (file.mime.match(/directory/)) {
          filelink.onclick = () => loadPath(file.fullpath);
        } else {
          filelink.onclick = () => console.log('TODO open file');
        }

        let contextMenuOpen = false;

        row.onmousemove = () => holdingCtrl || !dragging || selection.indexOf(file) != -1 || (selection.push(file), row.classList.add('selected'));
        row.onclick = event => {
          if (holdingCtrl) {
            selection.push(file);
            row.classList.add('selected');
          } else if (holdingCtrl) {
            return false;
          } else {
            selection = [file];
            rows.map(r => r == row ? r.classList.add('selected') : r.classList.remove('selected'));
          }
          /* event.preventDefault();
          event.stopPropagation();
          return false; */
        }

        const filename = createCell(filelink, 'file');
        if (file.filename.match(/^\./)) {
          row.classList.add('hidden');
        }

        row.addEventListener('contextmenu', function(event) {
          contextMenuOpen = true;
          contextmenu.style.left = `${event.clientX}px`;
          contextmenu.style.top = `${event.clientY}px`;
          contextmenu.style;
          contextmenu.style.height = Array.from(contextmenu.children).reduce((a,c) => c.offsetHeight + a, 0) - 1 + 'px';
          event.stopPropagation();
          event.preventDefault();
          return false;
        }, false);

        row.appendChild(createCell(createIcon(file)));
        row.appendChild(filename);
        row.appendChild(createCell(formatMime(file.mime)));
        row.appendChild(createCell(!file.mime.match(/directory/) && file.stats && file.stats.size != null ? formatSize(file.stats.size) : ''));
        row.appendChild(createCell(formatTimeStr(file.stats.mtime)));
        table.appendChild(row);
        rows.push(row);
      });

      const separator = document.createElement('div');
      separator.className = 'separator';
      filenavigator.appendChild(separator);

      filenavigator.appendChild(table);

      let iteration = 0;
      const refreshImages = () => {
        iteration++;
        const images = Array.from(document.querySelectorAll('img[data-loaded="false"]'));
        images.map(img => {
          if (img.naturalWidth === 0) {
            img.src = img.src.replace(/\?\d+$/, '') + '?' + (+new Date());
          } else {
            img.dataset.loaded = 'true';
          }
        });
        if (!images.length || iteration > 20) clearInterval(refreshInterval);
      };

      refreshImages();
      var refreshInterval = setInterval(refreshImages, 1000);
    });
  }
}

function formatMime(mime) {
  return ({
    'application/epub+zip': 'EPUB',
    'application/java-archive': 'Java Archive',
    'application/json': 'JSON',
    'application/ld+json': 'JSON-LD',
    'application/msword': 'Microsoft Word',
    'application/octet-stream': 'Binary file',
    'application/ogg': 'OGG audio',
    'application/pdf': 'PDF',
    'application/rtf': 'Rich Text Format',
    'application/vnd.amazon.ebook': 'Amazon Kindle eBook',
    'application/vnd.apple.installer+xml': 'Apple Installer Package',
    'application/vnd.mozilla.xul+xml': 'XUL',
    'application/vnd.ms-excel': 'Microsoft Excel',
    'application/vnd.ms-fontobject': 'MS Embedded OpenType font',
    'application/vnd.ms-powerpoint': 'Microsoft PowerPoint',
    'application/vnd.oasis.opendocument.presentation': 'OpenDocument presentation',
    'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument spreadsheet',
    'application/vnd.oasis.opendocument.text': 'OpenDocument text document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Microsoft PowerPoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Microsoft Excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Microsoft Word',
    'application/vnd.visio': 'Microsoft Visio',
    'application/x-7z-compressed': '7-zip archive',
    'application/x-abiword': 'AbiWord document',
    'application/x-bzip': 'BZip archive',
    'application/x-bzip2': 'BZip2 archive',
    'application/x-csh': 'C-Shell script',
    'application/x-freearc': 'Archive document',
    'application/x-rar-compressed': 'RAR archive',
    'application/x-sh': 'Bourne script',
    'application/x-shockwave-flash': 'Shockwave Flash',
    'application/x-tar': 'TAR archive',
    'application/xhtml+xml': 'XHTML',
    'application/xml': 'XML',
    'application/zip': 'ZIP archive',
    'audio/aac': 'AAC audio',
    'audio/midi': 'MIDI audio',
    'audio/x-midi': 'MIDI audio',
    'audio/mpeg': 'MP3 audio',
    'audio/ogg': 'OGG audio',
    'audio/wav': 'WAV audio',
    'audio/webm': 'WEBM audio',
    'font/otf': 'OpenType font',
    'font/ttf': 'TrueType Font',
    'font/woff': 'WOFF font',
    'font/woff2': 'WOFF font',
    'image/bmp': 'BMP image',
    'image/gif': 'GIF image',
    'image/jpeg': 'JPEG image',
    'image/png': 'PNG image',
    'image/svg+xml': 'SVG vector',
    'image/tiff': 'TIFF',
    'image/vnd.microsoft.icon': 'Icon',
    'image/webp': 'WEBP image',
    'inode/directory': 'Folder',
    'text/calendar': 'iCalendar',
    'text/css': 'CSS',
    'text/csv': 'CSV',
    'text/html': 'HTML',
    'text/javascript': 'Javascript',
    'text/plain': 'Text',
    'video/3gpp': '3GPP video',
    'video/mpeg': 'MPEG video',
    'video/ogg': 'OGG video',
    'video/webm': 'WEBM video',
    'video/x-msvideo': 'AVI video',
    'video/mp4': 'MP4 video',
  })[mime];
}

function createIcon(file) {
  if (file.thumbnail) return `<div class="thumbnail"><img src="http://192.168.5.14:1337/${file.thumbnail}" data-loaded="false" /></div>`;
  if (file.mime.match(/directory$/)) return '<i class="fas fa-folder"></i>'
  if (file.mime.match(/^audio/)) return '<i class="fas fa-file-audio"></i>';
  if (file.mime.match(/pdf$/)) return '<i class="fas fa-file-pdf"></i>';
  if (file.mime.match(/vnd.+presentation/)) return '<i class="fas fa-file-word"></i>';
  if (file.mime.match(/vnd.+sheet/)) return '<i class="fas fa-file-excel"></i>';
  if (file.mime.match(/vnd.+(text|document)/)) return '<i class="fas fa-file-powerpoint"></i>';
  if (file.mime.match(/application\/.*(zip|7z|tar|bz|bzip|gz|gzip)/)) return '<i class="fas fa-file-archive"></i>';
  if (file.mime.match(/^text/)) {
    if (file.filename.match(/\.(jsx?|json|tsx?|py|php|cc?|cpp|java|sh)$/)) return '<i class="fas fa-file-code"></i>';
    return '<i class="fas fa-file-alt"></i>';
  }

  return '<i class="fas fa-file"></i>';
}

function formatSize(size) {
  if (size < 1024) return Math.round(size / 1024 * 10) / 10 + 'kB';
  if (size < 1024 * 1024) return Math.round(size / 1024) + 'kB';
  if (size < 1024 * 1024 * 1024) return Math.round(size / 1024 / 1024 * 10) / 10 + 'MB';
  return Math.round(size / 1024 / 1024 / 1024 * 100) / 100 + 'GB';
}

function formatTimeStr(time) {
  return time.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).+$/, '<date>$1-$2-$3</date> <time>$4:$5</time>');
}

function initApps(approw) {
  //
  const apps = [
    { special: 'menu' },
    { name: 'chrome' },
    { name: 'mail' },
    { name: 'music' },
    { name: 'drive' },
    { name: 'sublime' },
    { name: 'docs' },
    { name: 'sheets' },
    { name: 'calendar' },
  ];

  approw.style.maxWidth = (apps.length * 150) + 'px';

  apps.map(app => {
    const icon = document.createElement('div');
    icon.className = 'icon';

    if (app.special == 'menu') {
      icon.className += ' menu';
      icon.innerHTML = '<i class="fas fa-bars"></i>';
    } else {
      icon.style.width = `calc(${100 / (apps.length)}% - 15px)`;
      icon.innerHTML = `<svg style="max-width: 64px;"><use xlink:href="#${app.name}" /></svg>`;
    }
    approw.appendChild(icon);
  });
}
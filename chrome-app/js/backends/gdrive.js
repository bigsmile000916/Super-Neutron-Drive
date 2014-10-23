function GDriveFS (name, info, root, scope, pid) {
  LocalFS.call(this, name, info, scope, pid);
  
  this.cid = 'GDriveFS';
  this.cls = "fa fa-google";
  this.outline = true;
  this.root = root;
  this.account = this.root.get_account(pid);
  this.working = false;
  this.transactions = {};
  this.pid = 'gdrive-' + pid + '-' + this.info;
  
  if (!this.account.fs) {
    this.account.fs = {};
  }
  
  this.account.fs[this.pid] = this;
}

GDriveFS.prototype = Object.create(LocalFS.prototype);

GDriveFS.prototype.postMessage = function (data) {
  var self = this;
  
  data.pid = self.pid;
  if (self.account.webview) {
    self.account.webview.contentWindow.postMessage(data, '*');
  }
  
  else {
    self.root.$emit('google-account-init', self.account, data);
  }
};

GDriveFS.prototype.list_fs = function (parentEntry, entry) {
  var self = this;
  
  //info is root folder id
  var folderId = self.info;
  if (parentEntry) {
    folderId = parentEntry.id;
    self.transactions[parentEntry.id] = parentEntry;
    parentEntry.working = true;
  }
  
  self.working = true;
  self.postMessage({task: 'list_dir', folderId: folderId});
};

GDriveFS.prototype.list_fs_callback = function (listing) {
  var self = this;
  var parentEntry = null;
  if (listing.folderId && self.transactions[listing.folderId]) {
    parentEntry = self.transactions[listing.folderId];
    delete self.transactions[listing.folderId];
  }
  
  else if (listing.folderId && self.info !== listing.folderId) {
    return null;
  }
  
  self.process_entries(self, parentEntry, listing.result, [], []);
};

GDriveFS.prototype.process_entries = function (self, parentEntry, entries, dirs, files) {
  var basepath = '';
  var path;
  
  if (parentEntry) {
    basepath = parentEntry.path;
  }
  
  for(var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    
    if (!entry.labels.trashed) {
      path = os.join_path(basepath, entry.title);
      
      if (entry.mimeType === 'application/vnd.google-apps.folder') {
        dirs.push({
          path: path,
          name: entry.title,
          dirs: [],
          files: [],
          state: 'closed',
          id: entry.id,
          working: false,
          parent: parentEntry
        });
      }
      
      else {
        files.push({
          path: path,
          name: entry.title,
          id: entry.id,
          retainer: entry.id,
          working: false,
          mimeType: entry.mimeType,
          parent: parentEntry
        });
      }
    }
  }
  
  dirs.sort(name_sort);
  files.sort(name_sort);
  
  if (parentEntry) {
    parentEntry.dirs = dirs;
    parentEntry.files = files;
    parentEntry.state = 'open';
    parentEntry.working = false;
  }
  
  else {
    if (self.info === "") {
      dirs.unshift({
        path: "Shared-With-Me",
        name: "Shared With Me",
        dirs: [],
        files: [],
        state: 'closed',
        id: "sharedWithMe",
        working: false
      });
    }
    
    self.dirs = dirs;
    self.files = files;
    self.state = 'open';
  }
  
  self.working = false;
  self.scope.$apply();
};

GDriveFS.prototype.open_file = function (file, range) {
  var self = this;
  
  self.scope.rootScope.$emit('addMessage', 'open-file' + file.id, 'info', 'Opening: ' + file.name, null, true);
  self.scope.rootScope.$emit('openTab', file.id, self.pid, range, function () {
    self.transactions[file.id] = {range: range, entry: file};
    self.postMessage({task: 'open', title: file.name, fileId: file.id});
  });
};


GDriveFS.prototype.open_file_callback = function (file) {
  var self = this;
  var range = self.transactions[file.fileId].range;
  var entry = self.transactions[file.fileId].entry;
  entry.name = file.title;
  entry.mimeType = file.mimeType;
  entry.retainer = file.id;
  
  self.scope.rootScope.$emit('removeMessage', 'open-file' + file.id);
  //todo: open range
  //todo: check transactions
  delete self.transactions[file.fileId];
  
  if (file.error) {
    self.root.error_message(file.error);
  }
  
  else {
    self.scope.rootScope.$emit('addTab', entry, file.content, self);
  }
};

GDriveFS.prototype.do_save = function (tab, name, path, text, md5sum, mid, errorHandler) {
  var self = this;
  self.transactions[tab.file.id] = {tab: tab, errorHandler: errorHandler, mid: mid, md5sum: md5sum};
  self.postMessage({
    task: 'save', text: text, title: name, fileId: tab.file.id, mimeType: tab.file.mimeType
  });
};

GDriveFS.prototype.do_save_callback = function (save) {
  var self = this;
  var t = self.transactions[save.fileId];
  delete self.transactions[save.fileId];
  
  if (save.error) {
    errorHandler();
  }
  
  else {
    t.tab.saved_md5sum = t.md5sum;
    t.tab.saving = false;
    self.scope.rootScope.$emit('removeMessage', t.mid);
    t.tab.scope.$apply();
  }
};

GDriveFS.prototype.do_rename = function (entry, name) {
  var self = this;
  self.transactions[entry.id] = entry;
  self.postMessage({task: 'rename', new_name: name, fileId: entry.id});
};

GDriveFS.prototype.do_rm = function (entry) {
  var self = this;
  self.transactions[entry.id] = entry;
  self.postMessage({task: 'trash', fileId: entry.id});
};

GDriveFS.prototype.rename_callback = function (data) {
  var self = this;
  var entry = self.transactions[data.fileId];
  
  entry.name = data.title;
  self.scope.rootScope.$emit('renameTab', self.pid, data.fileId, entry);
  apply_updates(self.scope);
  delete self.transactions[data.fileId];
};

GDriveFS.prototype.trash_callback = function (data) {
  var self = this;
  var entry = self.transactions[data.fileId];
  
  self.collapse_listing(entry.parent);
  self.list_dir(entry.parent);
  apply_updates(self.scope);
  delete self.transactions[data.fileId];
};

GDriveFS.prototype.save_new_file = function (entry, name) {
  var self = this;
  var parentId;
  
  if (entry.id) {
    parentId = entry.id;
  }
  
  else {
    parentId = entry.info;
  }
  
  self.scope.rootScope.$emit('addMessage', 'new-file', 'info', 'Creating: ' + name, null, true);
  self.transactions[parentId] = entry;
  self.postMessage({task: 'newfile', name: name, parentId: parentId});
};

GDriveFS.prototype.save_new_file_callback = function (data) {
  var self = this;
  var entry = self.transactions[data.parentId];
  delete self.transactions[data.parentId];
  
  if (data.error) {
    self.scope.rootScope.$emit('addMessage', 'new-file', 'error', data.error, true);
  }
  
  else {
    self.scope.rootScope.$emit('removeMessage', 'new-file');
    entry.state = 'closed';
    entry.dirs = [];
    entry.files = [];
    
    apply_updates(self.scope);
    self.open_file({name: data.title, id: data.id, path: data.title, retainer: data.id});
    
    if (entry.id) {
      self.list_dir(entry);
    }
    
    else {
      self.list_dir();
    }
  }
};

GDriveFS.prototype.reopen_file = function (retainer, name) {
  var self = this;
  var file = {path: name, name: name, id: retainer, retainer: retainer};
  self.open_file(file);
};

GDriveFS.store_projects = function (scope) {
  var drive_projects = [];
  for (var i=0; i < scope.projects.length; i++) {
    var p = scope.projects[i];
    if (p.cid == 'GDriveFS') {
      drive_projects.push({
        name: p.name,
        info: p.info,
        pid: p.pid,
        account: {
          name: p.account.name,
          id: p.account.id,
          oauth: p.account.oauth,
          email: p.account.email
        }
      });
    }
  }
  
  chrome.storage.sync.set({'drive_projects': JSON.stringify(drive_projects)}, function() {
    console.log('GDrive projects saved');
    console.log(drive_projects);
  });
};

GDriveFS.load_projects = function (scope, q) {
  var deferred = q.defer();
  
  chrome.storage.sync.get('drive_projects', function (obj) {
    GDriveFS.load_projects_callback(obj, scope, deferred);
  });
  
  return deferred.promise;
};

GDriveFS.load_projects_callback = function (obj, scope, promise) {
  if (obj && obj.drive_projects) {
    var projects = JSON.parse(obj.drive_projects);
    scope.rootScope.google_accounts = [];
    
    for (var i in projects) {
      var p = projects[i];
      var account = scope.rootScope.get_account(p.account.id);
      if (!account) {
        scope.rootScope.google_accounts.push(p.account);
      }
      
      p.account.style = {};
      p.cancel_style = {display: 'block'};
      p.account.root = '';
      scope.rootScope.$emit('webview-init', p.account.id);
    }
    
    scope.rootScope.$apply();
    for (var j in projects) {
      var pp = projects[j];
      GDriveFS.init(pp, scope);
    }
    scope.$apply();
  }
  
  promise.resolve();
};

GDriveFS.init = function (p, scope) {
  var project = new GDriveFS(p.name, p.info, scope.rootScope, scope, p.account.id);
  scope.projects.push(project);
};

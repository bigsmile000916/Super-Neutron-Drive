ndrive.controller('WebViewCtrl', function($scope, $rootScope) {
  $scope.get_account = $rootScope.get_account;
  $scope.cancel_style = {};
  
  $scope.add_account = function (event) {
    var id = null;
    var found;
    
    while (1) {
      id = Math.floor((Math.random() * 1000000) + 1);
      found = false;
      
      for (var i=0; i < $rootScope.google_accounts.length; i++) {
        if ($rootScope.google_accounts[i].id == id) {
          found = true;
          break;
        }
      }
      
      if (!found) {
        break;
      }
    }
    
    $rootScope.google_accounts.push({name: 'Retrieving ...', id: id, style: {}, root: ''});
    $scope.cancel_style = {display: 'block'};
    
    setTimeout(function () {
      var webview = document.querySelector("#webview" + id);
      webview.src = $rootScope.server_url + "/view-" + id;
      webview.addEventListener('newwindow', $scope.handle_popup);
      webview.addEventListener("loadstop", function (event) {
        webview.contentWindow.postMessage({task: 'handshake', id: id}, '*');
      });
    }, 50);
  };
  
  $scope.init_account = function (event, account, postData) {
    var id = account.id;
    var webview = document.querySelector("#webview" + id);
    $scope.show_webview(account);
    
    if (postData) {
      account.postData = postData;
    }
    webview.src = $rootScope.server_url + "/view-" + id;
    webview.addEventListener('newwindow', $scope.handle_popup);
    webview.addEventListener("loadstop", function (event) {
      webview.contentWindow.postMessage({
        task: 'handshake',
        id: id,
        oauth: account.oauth,
        email: account.email
      }, '*');
    });
  };
  
  $scope.handle_popup = function (event) {
    event.preventDefault();
    
    chrome.app.window.create('html/popup.html', {id: "popup", bounds: {width: 600, height: 600}},
      function(newwindow) {
        newwindow.contentWindow.onload = function(e) { 
          var newwebview = newwindow.contentWindow.document.querySelector("webview");
          event.window.attach(newwebview);
        }   
    });
  };
  
  $scope.receive_message = function (event) {
    var account;
    
    if (event.origin === $rootScope.server_url) {
      if (event.data && event.data.task) {
        var account_tasks = ['token', 'folder-picked', 'hide-webview'];
        var tasks_callbacks = {
          'list_dir': 'list_fs_callback',
          'open': 'open_file_callback',
          'save': 'do_save_callback'
        };
        
        if (account_tasks.indexOf(event.data.task) > -1 || tasks_callbacks[event.data.task]) {
          account = $scope.get_account(event.data.id);
        }
        
        if (event.data.task === 'close-popup') {
          var p = chrome.app.window.get('popup');
          if (p) {
            p.close();
          }
        }
        
        else if (event.data.task === 'hide-webview') {
          $scope.hide_webview(account);
          apply_updates($scope);
        }
        
        else if (event.data.task === 'token') {
          account.oauth = event.data.oauth;
          account.email = event.data.email;
          account.name = account.email;
          account.webview = document.querySelector("#webview" + account.id);
          $scope.hide_webview(account);
          apply_updates($scope);
          apply_updates($rootScope);
          
          console.log(account);
          $rootScope.$emit('google-added', account.id);
          
          if (account.postData) {
            account.webview.contentWindow.postMessage(account.postData, '*');
            account.postData = null;
            $rootScope.$emit('save-projects');
          }
        }
        
        else if (event.data.task === 'folder-picked') {
          $scope.hide_webview(account);
          apply_updates($scope);
          
          $rootScope.$emit('folder-picked', event.data.folderId);
          apply_updates($rootScope);
        }
        
        else if (tasks_callbacks[event.data.task]) {
          var pid = event.data.pid;
          account.fs[pid][tasks_callbacks[event.data.task]](event.data.result);
        }
      }
    }
  };
  
  $scope.webview_init = function (event, id) {
    var account = $scope.get_account(id);
    $scope.hide_webview(account);
  };
  
  $scope.hide_webview = function (account) {
    account.style = {'z-index': '-2000', 'visibility': 'hidden'};
    $scope.cancel_style = {display: 'none'};
  };
  
  $scope.show_webview = function (account) {
    account.style = {};
    $scope.cancel_style = {display: 'block'};
  };
  
  $scope.cancel = function () {
    for (var i=0; i < $rootScope.google_accounts.length; i++) {
      $scope.hide_webview($rootScope.google_accounts[i]);
    }
  };
  
  $scope.picker_folder = function (event, id) {
    var account = $scope.get_account(id);
    $scope.show_webview(account);
    account.webview.contentWindow.postMessage({task: 'pick-folder'}, '*');
  };
  
  $rootScope.$on('add-google-account', $scope.add_account);
  $rootScope.$on('google-account-init', $scope.init_account);
  $rootScope.$on('google-picker-folder', $scope.picker_folder);
  $rootScope.$on('webview-init', $scope.webview_init);
  window.addEventListener("message", $scope.receive_message, false);
});

if (typeof window.localStorage == 'undefined' || typeof window.sessionStorage == 'undefined') (function () {

var Storage = function (type) {
  function createCookie(name, value, days) {
    var date, expires;

    if (days) {
      date = new Date();
      date.setTime(date.getTime()+(days*24*60*60*1000));
      expires = "; expires="+date.toGMTString();
    } else {
      expires = "";
    }
    document.cookie = name+"="+value+expires+"; path=/";
  }

  function readCookie(name) {
    var nameEQ = name + "=",
        ca = document.cookie.split(';'),
        i, c;

    for (i=0; i < ca.length; i++) {
      c = ca[i];
      while (c.charAt(0)==' ') {
        c = c.substring(1,c.length);
      }

      if (c.indexOf(nameEQ) == 0) {
        return c.substring(nameEQ.length,c.length);
      }
    }
    return null;
  }
  
  function setData(data) {
    data = JSON.stringify(data);
    if (type == 'session') {
      window.name = data;
    } else {
      createCookie('localStorage', data, 365);
    }
  }
  
  function clearData() {
    if (type == 'session') {
      window.name = '';
    } else {
      createCookie('localStorage', '', 365);
    }
  }
  
  function getData() {
    var data = type == 'session' ? window.name : readCookie('localStorage');
    return data ? JSON.parse(data) : {};
  }


  // initialise if there's already data
  var data = getData();

  return {
    length: 0,
    clear: function () {
      data = {};
      this.length = 0;
      clearData();
    },
    getItem: function (key) {
      return data[key] === undefined ? null : data[key];
    },
    key: function (i) {
      // not perfect, but works
      var ctr = 0;
      for (var k in data) {
        if (ctr == i) return k;
        else ctr++;
      }
      return null;
    },
    removeItem: function (key) {
      delete data[key];
      this.length--;
      setData(data);
    },
    setItem: function (key, value) {
      data[key] = value+''; // forces the value to a string
      this.length++;
      setData(data);
    }
  };
};

if (typeof window.localStorage == 'undefined') window.localStorage = new Storage('local');
if (typeof window.sessionStorage == 'undefined') window.sessionStorage = new Storage('session');

})();



var IATI = IATI || {};

(function(IATI, $, _){
  var storage = window.localStorage,
      data = [],

      // increment this to reset all users dashboards
      // for when the api is switched over
      storeKey = 'dashboard-0';
  
  /* Data Format
  [{
    href:'/some/content/endpoint',
    key:'activities',
    subkey:'My USA AID Activities'
  },{
    href:'/some/content/endpoint.df',
    key:'datafile'
  }]
  */
  
  function persist(){
    storage.setItem(storeKey, JSON.stringify(data));
  }
  
  function fetch(){
    data = JSON.parse(storage.getItem(storeKey)) || [];
  }
  fetch();
  
  // see if a url is in any of the sections of the dashboard
  function contains(url){
    return _.any(data, function(part){
      return part.href == url;
    });
  }
  
  
  //public interface
  IATI.dashboard = {
    data:data,
    clear:function(){
      data = [];
      persist();
    },
    add:function(key, url){
      this.aadd({
        href:url,
        key:key
      });
    },
    aadd:function(obj){
      var contains = _.any(data, function(item){
        return _.isEqual(obj,item);
      });
      if(!contains){
        data.push(obj);
        persist();        
      }
    },
    subkeysFor:function(key){
      return _(data).chain().filter(function(d){
        return d.key == key;
      }).pluck('subkey').uniq().value();
    },
    get:function(key){
      return _.filter(data,function(d){
        return d.key == key;
      });
    },
    contains:contains
  };
  
  
  var subSectionTmpl = '<li class="sub"><h2></h2><table class="content full"></table></li>';
  
  // jQuery helper to put the content in the dashboard page
  $.fn.dashboardContent = function(){
    var $this = this;
    
    if(_.any(data, function(d){
      return d.key == 'activities';
    })){
      $('.groups .info').hide();
    }

    
    _.each(data, function(d){
      var target = $('[data-dashkey='+d.key+']',$this);

      if(d.subkey !== undefined){
        
        var newTarget = $('.sub', target).filter(function(){
          return $(this).data('subkey') == d.subkey;
        });

        
        if(!newTarget.size()){
          
          var params = _(data).chain()
            .filter(function(item){
              return item.key == d.key && item.subkey == d.subkey;
            })
            .map(function(item){
              var id = item.href.match(/\/activity\/([^\?]+)/)[1];
              return id ? {
                name:'ID',
                value:id
              } : false;
            })
            .compact().value();
          
          params.push({
            name:'title',
            value:d.subkey
          });
          
          
          var link = $('<a>',{
            'class':'xhr',
            'href':'/data-file?' + $.param(params)
          }).text(d.subkey);
          
          // create a new sub section
          newTarget = $(subSectionTmpl)
            .data('subkey', d.subkey)
            .find('h2').append(link).end()
            .prependTo(target);
        }
        
        target = newTarget;
        
      }
      
      var section = target.find('.content');
      
      if(d.type == 'embed'){
        var tmpl = d.subkey ? '<tr class="embedded">' : '<li class="embedded">';
        $(tmpl).appendTo(section).load(d.href,runInlines);
        
      } else {
        //presume iframe
        var widget = $('<li class="widget">');
        widget.appendTo(section);
        $('<iframe>', {
          src: d.href,  frameborder: 0, scrolling: "no",
          css: {width: widget.width(), height: widget.height()}
        }).appendTo(widget);
      }
      
    });
  };
  
  var addedAnimation = function(){
    $('.dashboard .saving').addClass('active');
    setTimeout(function(){
      $('.dashboard .saving').removeClass('active');
    }, 2500);
  };
  
  //update the class based on if this is on the dashboard
  $.fn.favourite = function(){
    return this.each(function(){
      var $this = $(this);
      var href = $this.data('dash') ?
        $this.data('dash').href :
        $this.attr('href');
      
      $this.toggleClass('added', contains(href));
    });
  };
  
  
  // var subkeyChoiceTmpl = '<ol><li><form><input type="text" name="groupname"/><input type="submit" value="create"/></form></li></ol>';
  
  var subkeyChoiceTmpl = '<li><form class="dashChoice"><label><span class="l">Add to group:</span><select><option value="0">Choose a group</option></select></label><label><span class="l">Or create another group:</span><input type="text" name="groupname" class="name"></label><input type="submit" value="create" class="submit"></form></li>';
  
  $('[data-dash]').live('click', function(e){
    e.preventDefault();
    
    if($('form.dashChoice').size()){
      $('form.dashChoice').slideUp(function(){
        $(this).remove();
      });
      
      //update the ui based on if it was added
      $(this).favourite();
      return;
    }
    
    var $this = $(this);
    
    $this.addClass('added');
    
    var _data = _.clone($this.data('dash'));
    
    if(_data.subkey === false){
      //subkey required, display dialog
      
      var content = $(subkeyChoiceTmpl);
      
      
      // add in the sub keys
      //find the sub keys
      var select = content.find('select');
      _.each(IATI.dashboard.subkeysFor(_data.key), function(subkey){
        var k = $('<option>',{value:subkey}).text(subkey);
        content.find('select').append(k);
      });
      select.change(function(){
        var v = $(this).val();
        if(v){
          _data.subkey = v;
          IATI.dashboard.aadd(_data);
          addedAnimation();
          content.slideUp();
        }
      });
      
      if(select.find('option').size()==1){
        content.find('label').first().hide();
        content.find('.l').last().text('Create a group:');
      }
      
      
      content.find('form').submit(function(e){
        e.preventDefault();
        
        // get the input text, and create a subkey
        var subkey = content.find('input').val();
        if(subkey === '') return;
        
        _data.subkey = subkey;
        
        IATI.dashboard.aadd(_data);
        addedAnimation();
        content.slideUp();
        
      });
      
      content.hide().appendTo($this.closest('li')).slideDown();
      
      
    } else {
      IATI.dashboard.aadd(_data);
      addedAnimation();
    }
    
  });
  
  
})(IATI, jQuery, _);


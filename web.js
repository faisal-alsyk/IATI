var express = require('express'),
    connect = require('connect'),
    api = require('./lib/api.js'),
    app = module.exports = express.createServer(),
    querystring = require('querystring'),
    url = require('url'),
    _ = require('underscore'),
    assetManager = require('connect-assetmanager'),
    assetHandler = require('connect-assetmanager-handlers'),
    helpers = require('./lib/helpers.js');

//All the script files that should be served to the client
var clientScripts = [
  'lib/jquery.js', 
  'lib/d3.min.js', 
  'lib/d3.layout.min.js', 
  'lib/jquery.history.js', //Causes problems when minified
  'lib/seedrandom.js',
  'lib/underscore.js',
  'dashboard.js',
  'bubble.jquery.js', 
  'zoomer.js', 
  'scroller.js',
  'plugins.js', 
  'script.js'
];


//Set the cache to the time at which the app was started.
//Ideally this would be a hash of the script files or 
//the most recent modification date
var cacheKey = (new Date()).getTime();
var clientScripts_combined = ['../static/js/' + cacheKey + '/client.js'];

app.configure(function() {
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  
  app.use(connect.compiler({
    src: __dirname + '/public', 
    enable: ['less'] })
  );
  
  app.use(express.static(__dirname + '/public'));
  
  //Custom app settings
  app.set('pageSize', 20);
  
  
  //Combination and minification of static files
  app.use(assetManager({
    'js':{
      'route' : /\/static\/js\/[0-9]+\/.*\.js/,
      'path': './public/javascripts/',
      'dataType': 'javascript',
      'files': clientScripts,
      'postManipulate': {
          '^': [assetHandler.uglifyJsOptimize]
      }
    }
    /* todo, problems:
        - no import inlining
        - fs *.css wont be written to fs until requested
    
    , 'css': {
      'route': /\/static\/css\/[0-9]+\/.*\.css/,
      'path': './public/stylesheets/',
      'dataType': 'css', 
      'files': ['style.css'],
      'preManipulate': {
        '^': [
          assetHandler.yuiCssOptimize,
          assetHandler.replaceImageRefToBase64(root)
        ]
      }
    }*/
  }));
});

app.configure('development', function() {
  
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
  
  app.set('view options', {
    title: '[DEV] Aid View',
    clientScripts: clientScripts
  });
  
});

app.configure('production', function() {
  
  app.use(express.errorHandler()); 
  
  app.set('view options', {
    title: 'Aid View',
    clientScripts: clientScripts_combined
  });
  
});

_.mixin({
  //Returns an array by wrapping non-arrays in an array
  as_array: function(something) {
    return something === undefined ? [] : (_.isArray(something) ? something : [something]);
  },
  
  //Sums an array of values
  sum: function(array) {
    return _(array).reduce(function(a, b) { return a + b; }, 0);
  }
});

app.dynamicHelpers({
  query: function(req){
    return req.query;
  },

  //Adds parameters to the url
  url_with: function(req, res) {
    return function(pathname, params) {
      //Parse the current url, inserting updated query paramaters and specified options
      var parsedUrl = url.parse(req.originalUrl, true);
      parsedUrl.query = _(req.query).clone();
      if (pathname) parsedUrl.pathname = pathname;
      if (params) _.extend(parsedUrl.query, params);
      
      //Remove the xhr param (this is used as a work around for cache issues)
      if (parsedUrl.query.xhr) delete parsedUrl.query.xhr;
      
      //Remove search query string, forcing query object to be used
      delete parsedUrl.search;
      
      //Return the formatted url
      return url.format(parsedUrl);
    };
  }
});

app.helpers(helpers);


var beforeFilter = function(req, res, next) {
  //Get query, filtering unwanted values
  var keep = 'Region Country Sector SectorCategory Funder orderby'.split(' ');
  req.filter_query = _.reduce(req.query, function(memo, value, key) {
    if (_.include(keep, key)) memo[key] = value;
    return memo;
  },{});
  
  req.queryString = req.originalUrl.split('?')[1] || '';
  req.isXHR = req.headers['x-requested-with'] == 'XMLHttpRequest';
  next();
};

//Routes

app.get('/', beforeFilter, function(req, res) {
  res.render('index', {
    filter_paths: req.filter_paths,
    layout: !req.isXHR
  });
});


app.get('/activities', beforeFilter, function(req, res, next) {
  var page = parseInt(req.query.p || 1, 10);
  var start = ((page - 1) * app.settings.pageSize) + 1;
  var params = {
    result: 'values',
    pagesize: app.settings.pageSize, 
    start: start
  };

  _.extend(params, req.filter_query);
  new api.Request(params)
  .on('success', function(data) {
    var activities = _.as_array(data['iati-activity']);
    var total = data['@activity-count'] || 0;
    var pagination = (total <= app.settings.pageSize) ? false : {
      current: parseInt(req.query.p || 1, 10),
      total: Math.ceil(total / app.settings.pageSize)
    };
    
    delete req.query.view;
    res.render('activities', {
      title: 'Activities',
      page: 'activities',
      filter_paths: req.filter_paths,
      query: req.query,
      activities: activities,
      activity_count: total,
      current_page: req.query.p || 1,
      pagination: pagination,
      layout: !req.isXHR
    });
  })
  .on('error', function(e) {
    next(e);
  })
  .end();
});


app.get('/data-file', beforeFilter, function(req, res, next) {
  //Sums all transactions with a particular code
  var transactionsTotal = function(activities, code) {
    return _(activities).chain()
      .map(function(a) {
        return _(a.transaction || []).filter(function(t) {
          return (t['transaction-type'] || {})['@code'] == code;
        });
      })
      .flatten()
      .map(function(t) { return parseFloat(t.value["@iati-ad:USD-value"] || 0); })
      .sum().value();
  };
  
  var newProjects = function(activities, limit) {
    return _(activities).chain()
      .sortBy(function(a) {
        var date = _(a['activity-date'] || []).find(function(t) {
          return (t["@type"]) == "start-actual";
        });
        console.log(date ? Date.parse(date["#text"]) : 0);
        return date ? Date.parse(date["#text"]) : 0;
      })
      .map(function(a) {
        return a.title || "No description available";
      })
      .value().slice(0, limit);
  };

  var params = { result: 'full' };

  _.extend(params, req.filter_query);
  new api.Request(params)
  .on('success', function(data) {
    var activities = _.as_array(data['iati-activity']);
    
    res.render('data-file', {
      title: 'Data File',
      page: 'data-file',
      filter_paths: req.filter_paths,
      query: req.query,
      activities: activities,
      new_projects: newProjects(activities, 3),
      total_budget: transactionsTotal(activities, 'C'),
      total_spend: transactionsTotal(activities, 'D') + transactionsTotal(activities, 'E'),
      activity_count: data['@activity-count'] || 0,
      current_page: req.query.p || 1,
      layout: !req.isXHR
    });
  })
  .on('error', function(e) {
    next(e);
  })
  .end();
});


app.get('/activity/:id', beforeFilter, function(req, res, next) {
  api.Request({ID:req.params.id, result:'full'})
    .on('success', function(data) {
      res.render('activity', {
        activity: data['iati-activity'],
        layout: !req.isXHR
      });
    })
    .on('error', function(e) {
      next(e);
    })
    .end();
});


app.get('/filter/:filter_key', beforeFilter, function(req, res, next) {
  var filter_key = req.params.filter_key;
  var params = {result: 'values', groupby: filter_key};
  _.extend(params, req.filter_query);
  
  new api.Request(params)
    .on('success', function(data) {
      res.render('filter', {
        choices: _.as_array(data[filter_key]),
        key: filter_key,
        title: 'Filter by ' + filter_key,
        page: 'filter',
        layout: !req.isXHR
      });
    })
    .on('error', function(e) {
      next(e);
    })
    .end();
});


app.get('/dashboard', beforeFilter, function(req, res, next){
  res.render('dashboard', {
    layout: !req.isXHR
  });
});


app.get('/list', beforeFilter, function(req, res) {
  res.render('activities-list', {
    layout: !req.isXHR
  });
});


var widgets = require('./widgets.js');
widgets.init(app, beforeFilter, api, _);


//Only listen on $ node app.js
if (!module.parent) {
  app.listen(process.env.PORT || 3000);
  console.log("Express server listening on port %d", app.address().port);
}

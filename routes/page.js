
/*
 * 七日知识管理系统
 * Copyright(c) qiri.com <yanxi@yanxi.com>
 * MIT Licensed
 */
 
var _ = require('underscore')
  , _s = require('underscore.string')
  , config = require('../config')
  , mongoUtils = require('../model/mongo-utils.js')
  , wiki2html = require('../lib/wiki2html.js')
  , Page = mongoUtils.getSchema('Page')
  , User = mongoUtils.getSchema('User')
  , QiriError = require('../model/qiri-err')
  , qiriUtils = require('../model/qiri-utils');

var simpleFormatDate = function(date, format) {
    var toString = function(num, len) {
        if (num<10 && len==2) return "0" + num;
        return num;
    }
    return (format || "yyyy-MM-dd")
        .replace(/\byyyy\b/, date.getYear() + 1900)
        .replace(/\bMM\b/, toString(date.getMonth() + 1, 2))
        .replace(/\bM\b/, toString(date.getMonth() + 1))
        .replace(/\bdd\b/, toString(date.getDate(), 2))
        .replace(/\bd\b/, toString(date.getDate()))
}

exports.show = function(req, res, next) {
  var visitor = req.visitor;
  var pageId = req.params.id;

  var page, parentPage, brotherPages, childPages;
  var render = function() {
    if (qiriUtils.ready(page, parentPage, brotherPages, childPages)) {
      res.render('page-show', {
          config: config,
          visitor: visitor,
          page: page,
          parentPage: parentPage,
          brotherPages: brotherPages,
          childPages: childPages,
          isDefaultPage: ('/page/' + page.id) == config.get('defaultPage')
      });
    }
  };

  var preparePage = function(doc) {
    prepareChildPages(doc);
    var prepareAll = function(author) {
        prepareParentPage(doc.parentId, author);
        doc.contentHtml = wiki2html.convert(doc.content);
        page = doc;
        page.addDateFormatted = simpleFormatDate(page.addDate, 'yyyy年M月d日');
        render();
    }
    if (visitor && visitor.userid === doc.userId) {
        prepareAll(visitor);
    } else {
        User.findById(doc.userId, function(err, author) {
            if (err) {
              return next(new QiriError(err));
            } 
            if (!author) {
              return next(new QiriError('author is null'));
            }
            if ((doc.rootId || doc.id) == author.rootPageId     // 页面私有
                     && (visitor && visitor.id) != author.id    // 访问者非作者
                    ) {
                return next(new QiriError(403));
            }
            prepareAll(author);
        });
    }
  }

  // page
  Page.findById(pageId, function(err, doc) {
        if (err) {
          return next(new QiriError(err));
        }
        if (!doc) {
          return next(new QiriError(404));
        }
        preparePage(doc);
    }
  );
 
  var getSortedPages = function(pages, childIds) {
      var childOrderMap = {};
      _(childIds || []).each(function(childId, index) {
        childOrderMap[childId] = index;
      });
      return _(pages).sortBy(function(page){
        return childOrderMap[page.id];
      });
  }
 
  // childPages
  var prepareChildPages = function(page) {
      Page.find({parentId: page.id}, "title", function(err, pages){
        if (err) {
          return next(new QiriError(err));
        } 
        childPages = getSortedPages(pages, page.childIds);
        render();
      });
  }

  // parentPage
  var prepareParentPage = function(parentId, author) {
      if(parentId && parentId != author.id) {
          Page.findById(parentId, "title childIds", function(err, page){
              if (err) {
                return next(new QiriError(err));
              }
              if (!page) {
                return next(new QiriError("找不到父页面"));
              }
              parentPage = page;
              prepareBrotherPages(parentId, page.childIds, author);
          });
      } else {
          parentPage = {};
          brotherPages = [];
          render();
      }
  };

  // brotherPages
  var prepareBrotherPages = function(parentId, childIds, author) {
      if(parentId && parentId != author.id) {
          Page.find({
              parentId: parentId
            }, 
            "title", 
            function(err, pages) {
              if (err) {
                return next(new QiriError(err));
              } 
              brotherPages = getSortedPages(pages, childIds);
              render();
            }
          );
      } else {
          brotherPages = [];
          render();
      }
  };
};

exports.create = function(req, res, next) {
    var visitor = req.visitor;
    if(!visitor) {
        return next(new QiriError('用户未登录'));
    }
  
    var parentId = req.param('parentId');
    var title = _s.trim(req.param('title')) || "";
    var content = _s.trim(req.param('content')) || "";
    var rootId = null;
    if (title.length<1 || title.length>50) {
        return next(new QiriError('标题长度必须在1到50之间'));
    }

    var createPage = function() {
        Page.create({
            userId: visitor.id,
            parentId: parentId,
            rootId: rootId,
            title: title,
            content: content
        }, function(err, page) {
            if (err) {
              return next(new QiriError(err));
            } 
            Page.update({_id: parentId, userId: visitor.id},
              {$push: {childIds: page.id}},
              function(err) {
                if (err) {
                  return next(new QiriError(err));
                } 
                res.json({pageId: page.id});
              }
            );
        });
    };

    var checkTitle = function() {
        Page.findOne({
              parentId: parentId,
              title: title
          },
          function(err, doc) {
              if (err) {
                return next(new QiriError(err));
              } 
              if(doc) {
                  return next(new QiriError('同一个级别已存在同名页面'));
              }
              createPage();
            }
        );
    }

    Page.findOne({
            _id: parentId,
            userId: visitor.id
        },
        function(err, parentPage) {
            if (err) {
              return next(new QiriError(err));
            } 
            if(!parentPage) {
              return next(new QiriError('parentPage is null'));
            }
            rootId = parentPage.rootId || parentPage.id;
            checkTitle();
        } 
    );

};

exports.remove = function(req, res, next) {
  var visitor = req.visitor;
  if(!visitor) {
    return next(new QiriError('用户未登录'));
  }

  var pageId = req.param('id') || "";
  Page.remove({
      _id: pageId,
      userId: visitor.id
    }, function(err) {
        if (err) {
          return next(new QiriError(err));
        } 
        res.json({});
    }
  );
}

exports.update = function(req, res, next) {
  var visitor = req.visitor;
  if(!visitor) {
    return next(new QiriError('用户未登录'));
  }

  var pageId = req.param('id') || "";
  var title = req.param('title') || "";
  var content = req.param('content') || "";
  if (pageId.length == 0) {
    return next(new QiriError('文章ID错误'));
  }
  if (title.length<1 || title.length>50) {
    return next(new QiriError('标题长度必须在1到50之间'));
  }
  Page.findOneAndUpdate({
      _id: pageId,
      userId: visitor.id
    }, {
      title: title,
      content: content
    }, function(err) {
      if (err) {
        return next(new QiriError(err));
      } 
      res.json({});
    }
  );
}

exports.add = function(req, res, next) {
  var visitor = req.visitor;
  var parentId = req.params.id;
  if(!visitor) {
    res.redirect('/');
    return;
  }

  res.render('page-add', {
    visitor: visitor,
    parentId: parentId
  });
}

exports.edit = function(req, res, next) {
  var visitor = req.visitor;
  if(!visitor) {
    res.redirect('/');
    return;
  }

  Page.findOne({
      _id: req.params.id
    },
    function(err, doc) {
      if (err) {
        return next(new QiriError(err));
      } 
      if(!doc) {
        return next(new QiriError(404));
      }
      var pageUserId = doc.userId;
      if (pageUserId != visitor.id) {
        return next(new QiriError(403));
      }
      res.render('page-edit', {page: doc});
    }
  );
}

exports.sort = function(req, res, next) {
  var visitor = req.visitor;
  if(!visitor) {
    return next(new QiriError('用户未登录'));
  }

  var pageId = req.param('id') || "";
  var childIds = _((req.param('childIds') || "").split(",")).filter(function(childId){
    return childId.match(/^\w{24}$/);
  });
  Page.findOneAndUpdate({
      _id: pageId,
      userId: visitor.id
    }, {
      childIds: childIds
    }, function(err, page){
      if (err) {
        return next(new QiriError(err));
      } 
      res.json({});
    }
  );
}


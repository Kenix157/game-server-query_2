(function(){
  "use strict";

  function Extend() {
    var args = Array.prototype.slice.call(arguments);
    var name,parent;
    if (typeof args[0] == 'string'){
      name = args.shift();
    } else {
      name = 'Extend';
    }
    if (args.length >= 2) {
      parent = args.shift();
    } else {
      parent = this;
    }

    var prop = args.shift();
    var prototype = {};
    var key;

    for (key in parent.prototype) {
      prototype[key] = parent.prototype[key];
    }

    for (key in prop) {
      if (typeof prop[key] == "function" && /\b_super\b/.test(prop[key])) {

        prototype[key] = (function(ref, fn) {
          return function() {
            var tmp = this._super;

            if (typeof parent.prototype[ref] == 'undefined') {
              if (ref == 'init'){
                this._super = parent.prototype.constructor;
              } else {
                this._super = function() {
                  throw new Error('Called _super in method without a parent');
                };
              }
            } else {
              this._super = parent.prototype[ref];
            }

            var ret = fn.apply(this, arguments);
            this._super = tmp;

            return ret;
          };
        })(key, prop[key]);
      } else {
        prototype[key] = prop[key];
      }
    }

    function ExtendedObject() {
      if (this.init) this.init.apply(this, arguments);
    }

    ExtendedObject.prototype = prototype;
    ExtendedObject.prototype.constructor = ExtendedObject;
    ExtendedObject.extend = Extend;

    return ExtendedObject;
  }

  module.exports = exports = Extend;
})();

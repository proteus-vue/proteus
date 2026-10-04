"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/dist/shared.cjs.prod.js
  var require_shared_cjs_prod = __commonJS({
    "node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/dist/shared.cjs.prod.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      // @__NO_SIDE_EFFECTS__
      function makeMap(str) {
        const map = /* @__PURE__ */ Object.create(null);
        for (const key of str.split(",")) map[key] = 1;
        return (val) => val in map;
      }
      var EMPTY_OBJ = {};
      var EMPTY_ARR = [];
      var NOOP = () => {
      };
      var NO = () => false;
      var isOn = (key) => key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && // uppercase letter
      (key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97);
      var isModelListener = (key) => key.startsWith("onUpdate:");
      var extend = Object.assign;
      var remove = (arr, el) => {
        const i = arr.indexOf(el);
        if (i > -1) {
          arr.splice(i, 1);
        }
      };
      var hasOwnProperty = Object.prototype.hasOwnProperty;
      var hasOwn = (val, key) => hasOwnProperty.call(val, key);
      var isArray = Array.isArray;
      var isMap = (val) => toTypeString(val) === "[object Map]";
      var isSet = (val) => toTypeString(val) === "[object Set]";
      var isDate = (val) => toTypeString(val) === "[object Date]";
      var isRegExp = (val) => toTypeString(val) === "[object RegExp]";
      var isFunction = (val) => typeof val === "function";
      var isString = (val) => typeof val === "string";
      var isSymbol = (val) => typeof val === "symbol";
      var isObject = (val) => val !== null && typeof val === "object";
      var isPromise = (val) => {
        return (isObject(val) || isFunction(val)) && isFunction(val.then) && isFunction(val.catch);
      };
      var objectToString = Object.prototype.toString;
      var toTypeString = (value) => objectToString.call(value);
      var toRawType = (value) => {
        return toTypeString(value).slice(8, -1);
      };
      var isPlainObject = (val) => toTypeString(val) === "[object Object]";
      var isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
      var isReservedProp = /* @__PURE__ */ makeMap(
        // the leading comma is intentional so empty string "" is also included
        ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
      );
      var isBuiltInDirective = /* @__PURE__ */ makeMap(
        "bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo"
      );
      var cacheStringFunction = (fn) => {
        const cache = /* @__PURE__ */ Object.create(null);
        return ((str) => {
          const hit = cache[str];
          return hit || (cache[str] = fn(str));
        });
      };
      var camelizeRE = /-\w/g;
      var camelize = cacheStringFunction(
        (str) => {
          return str.replace(camelizeRE, (c) => c.slice(1).toUpperCase());
        }
      );
      var hyphenateRE = /\B([A-Z])/g;
      var hyphenate = cacheStringFunction(
        (str) => str.replace(hyphenateRE, "-$1").toLowerCase()
      );
      var capitalize = cacheStringFunction((str) => {
        return str.charAt(0).toUpperCase() + str.slice(1);
      });
      var toHandlerKey = cacheStringFunction(
        (str) => {
          const s = str ? `on${capitalize(str)}` : ``;
          return s;
        }
      );
      var hasChanged = (value, oldValue) => !Object.is(value, oldValue);
      var invokeArrayFns = (fns, ...arg) => {
        for (let i = 0; i < fns.length; i++) {
          fns[i](...arg);
        }
      };
      var def = (obj, key, value, writable = false) => {
        Object.defineProperty(obj, key, {
          configurable: true,
          enumerable: false,
          writable,
          value
        });
      };
      var looseToNumber = (val) => {
        const n = parseFloat(val);
        return isNaN(n) ? val : n;
      };
      var toNumber = (val) => {
        const n = isString(val) ? Number(val) : NaN;
        return isNaN(n) ? val : n;
      };
      var _globalThis;
      var getGlobalThis = () => {
        return _globalThis || (_globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      };
      var identRE = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/;
      function genPropsAccessExp(name) {
        return identRE.test(name) ? `__props.${name}` : `__props[${JSON.stringify(name)}]`;
      }
      function genCacheKey(source, options) {
        return source + JSON.stringify(
          options,
          (_, val) => typeof val === "function" ? val.toString() : val
        );
      }
      var PatchFlags = {
        "TEXT": 1,
        "1": "TEXT",
        "CLASS": 2,
        "2": "CLASS",
        "STYLE": 4,
        "4": "STYLE",
        "PROPS": 8,
        "8": "PROPS",
        "FULL_PROPS": 16,
        "16": "FULL_PROPS",
        "NEED_HYDRATION": 32,
        "32": "NEED_HYDRATION",
        "STABLE_FRAGMENT": 64,
        "64": "STABLE_FRAGMENT",
        "KEYED_FRAGMENT": 128,
        "128": "KEYED_FRAGMENT",
        "UNKEYED_FRAGMENT": 256,
        "256": "UNKEYED_FRAGMENT",
        "NEED_PATCH": 512,
        "512": "NEED_PATCH",
        "DYNAMIC_SLOTS": 1024,
        "1024": "DYNAMIC_SLOTS",
        "DEV_ROOT_FRAGMENT": 2048,
        "2048": "DEV_ROOT_FRAGMENT",
        "CACHED": -1,
        "-1": "CACHED",
        "BAIL": -2,
        "-2": "BAIL"
      };
      var PatchFlagNames = {
        [1]: `TEXT`,
        [2]: `CLASS`,
        [4]: `STYLE`,
        [8]: `PROPS`,
        [16]: `FULL_PROPS`,
        [32]: `NEED_HYDRATION`,
        [64]: `STABLE_FRAGMENT`,
        [128]: `KEYED_FRAGMENT`,
        [256]: `UNKEYED_FRAGMENT`,
        [512]: `NEED_PATCH`,
        [1024]: `DYNAMIC_SLOTS`,
        [2048]: `DEV_ROOT_FRAGMENT`,
        [-1]: `CACHED`,
        [-2]: `BAIL`
      };
      var ShapeFlags = {
        "ELEMENT": 1,
        "1": "ELEMENT",
        "FUNCTIONAL_COMPONENT": 2,
        "2": "FUNCTIONAL_COMPONENT",
        "STATEFUL_COMPONENT": 4,
        "4": "STATEFUL_COMPONENT",
        "TEXT_CHILDREN": 8,
        "8": "TEXT_CHILDREN",
        "ARRAY_CHILDREN": 16,
        "16": "ARRAY_CHILDREN",
        "SLOTS_CHILDREN": 32,
        "32": "SLOTS_CHILDREN",
        "TELEPORT": 64,
        "64": "TELEPORT",
        "SUSPENSE": 128,
        "128": "SUSPENSE",
        "COMPONENT_SHOULD_KEEP_ALIVE": 256,
        "256": "COMPONENT_SHOULD_KEEP_ALIVE",
        "COMPONENT_KEPT_ALIVE": 512,
        "512": "COMPONENT_KEPT_ALIVE",
        "COMPONENT": 6,
        "6": "COMPONENT"
      };
      var SlotFlags = {
        "STABLE": 1,
        "1": "STABLE",
        "DYNAMIC": 2,
        "2": "DYNAMIC",
        "FORWARDED": 3,
        "3": "FORWARDED"
      };
      var slotFlagsText = {
        [1]: "STABLE",
        [2]: "DYNAMIC",
        [3]: "FORWARDED"
      };
      var GLOBALS_ALLOWED = "Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt,console,Error,Symbol";
      var isGloballyAllowed = /* @__PURE__ */ makeMap(GLOBALS_ALLOWED);
      var isGloballyWhitelisted = isGloballyAllowed;
      var range = 2;
      function generateCodeFrame(source, start = 0, end = source.length) {
        start = Math.max(0, Math.min(start, source.length));
        end = Math.max(0, Math.min(end, source.length));
        if (start > end) return "";
        let lines = source.split(/(\r?\n)/);
        const newlineSequences = lines.filter((_, idx) => idx % 2 === 1);
        lines = lines.filter((_, idx) => idx % 2 === 0);
        let count = 0;
        const res = [];
        for (let i = 0; i < lines.length; i++) {
          count += lines[i].length + (newlineSequences[i] && newlineSequences[i].length || 0);
          if (count >= start) {
            for (let j = i - range; j <= i + range || end > count; j++) {
              if (j < 0 || j >= lines.length) continue;
              const line = j + 1;
              res.push(
                `${line}${" ".repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`
              );
              const lineLength = lines[j].length;
              const newLineSeqLength = newlineSequences[j] && newlineSequences[j].length || 0;
              if (j === i) {
                const pad = start - (count - (lineLength + newLineSeqLength));
                const length = Math.max(
                  1,
                  end > count ? lineLength - pad : end - start
                );
                res.push(`   |  ` + " ".repeat(pad) + "^".repeat(length));
              } else if (j > i) {
                if (end > count) {
                  const length = Math.max(Math.min(end - count, lineLength), 1);
                  res.push(`   |  ` + "^".repeat(length));
                }
                count += lineLength + newLineSeqLength;
              }
            }
            break;
          }
        }
        return res.join("\n");
      }
      function normalizeStyle(value) {
        if (isArray(value)) {
          const res = {};
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            const normalized = isString(item) ? parseStringStyle(item) : normalizeStyle(item);
            if (normalized) {
              for (const key in normalized) {
                res[key] = normalized[key];
              }
            }
          }
          return res;
        } else if (isString(value) || isObject(value)) {
          return value;
        }
      }
      var listDelimiterRE = /;(?![^(]*\))/g;
      var propertyDelimiterRE = /:([^]+)/;
      var styleCommentRE = /\/\*[^]*?\*\//g;
      function parseStringStyle(cssText) {
        const ret = {};
        cssText.replace(styleCommentRE, "").split(listDelimiterRE).forEach((item) => {
          if (item) {
            const tmp = item.split(propertyDelimiterRE);
            tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
          }
        });
        return ret;
      }
      function stringifyStyle(styles) {
        if (!styles) return "";
        if (isString(styles)) return styles;
        let ret = "";
        for (const key in styles) {
          const value = styles[key];
          if (isString(value) || typeof value === "number") {
            const normalizedKey = key.startsWith(`--`) ? key : hyphenate(key);
            ret += `${normalizedKey}:${value};`;
          }
        }
        return ret;
      }
      function normalizeClass(value) {
        let res = "";
        if (isString(value)) {
          res = value;
        } else if (isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const normalized = normalizeClass(value[i]);
            if (normalized) {
              res += normalized + " ";
            }
          }
        } else if (isObject(value)) {
          for (const name in value) {
            if (value[name]) {
              res += name + " ";
            }
          }
        }
        return res.trim();
      }
      function normalizeProps(props) {
        if (!props) return null;
        let { class: klass, style } = props;
        if (klass && !isString(klass)) {
          props.class = normalizeClass(klass);
        }
        if (style) {
          props.style = normalizeStyle(style);
        }
        return props;
      }
      var HTML_TAGS = "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot";
      var SVG_TAGS = "svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,text,textPath,title,tspan,unknown,use,view";
      var MATH_TAGS = "annotation,annotation-xml,maction,maligngroup,malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,none,semantics";
      var VOID_TAGS = "area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr";
      var isHTMLTag = /* @__PURE__ */ makeMap(HTML_TAGS);
      var isSVGTag = /* @__PURE__ */ makeMap(SVG_TAGS);
      var isMathMLTag = /* @__PURE__ */ makeMap(MATH_TAGS);
      var isVoidTag = /* @__PURE__ */ makeMap(VOID_TAGS);
      var specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
      var isSpecialBooleanAttr = /* @__PURE__ */ makeMap(specialBooleanAttrs);
      var isBooleanAttr = /* @__PURE__ */ makeMap(
        specialBooleanAttrs + `,async,autofocus,autoplay,controls,default,defer,disabled,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected`
      );
      function includeBooleanAttr(value) {
        return !!value || value === "";
      }
      var unsafeAttrCharRE = /[>/="'\u0009\u000a\u000c\u000d\u0020]/;
      var attrValidationCache = {};
      function isSSRSafeAttrName(name) {
        if (attrValidationCache.hasOwnProperty(name)) {
          return attrValidationCache[name];
        }
        const isUnsafe = unsafeAttrCharRE.test(name);
        if (isUnsafe) {
          console.error(`unsafe attribute name: ${name}`);
        }
        return attrValidationCache[name] = !isUnsafe;
      }
      var propsToAttrMap = {
        acceptCharset: "accept-charset",
        className: "class",
        htmlFor: "for",
        httpEquiv: "http-equiv"
      };
      var isKnownHtmlAttr = /* @__PURE__ */ makeMap(
        `accept,accept-charset,accesskey,action,align,allow,alt,async,autocapitalize,autocomplete,autofocus,autoplay,background,bgcolor,border,buffered,capture,challenge,charset,checked,cite,class,code,codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,coords,crossorigin,csp,data,datetime,decoding,default,defer,dir,dirname,disabled,download,draggable,dropzone,enctype,enterkeyhint,for,form,formaction,formenctype,formmethod,formnovalidate,formtarget,headers,height,hidden,high,href,hreflang,http-equiv,icon,id,importance,inert,integrity,ismap,itemprop,keytype,kind,label,lang,language,loading,list,loop,low,manifest,max,maxlength,minlength,media,min,multiple,muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,referrerpolicy,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,selected,shape,size,sizes,slot,span,spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,target,title,translate,type,usemap,value,width,wrap`
      );
      var isKnownSvgAttr = /* @__PURE__ */ makeMap(
        `xmlns,accent-height,accumulate,additive,alignment-baseline,alphabetic,amplitude,arabic-form,ascent,attributeName,attributeType,azimuth,baseFrequency,baseline-shift,baseProfile,bbox,begin,bias,by,calcMode,cap-height,class,clip,clipPathUnits,clip-path,clip-rule,color,color-interpolation,color-interpolation-filters,color-profile,color-rendering,contentScriptType,contentStyleType,crossorigin,cursor,cx,cy,d,decelerate,descent,diffuseConstant,direction,display,divisor,dominant-baseline,dur,dx,dy,edgeMode,elevation,enable-background,end,exponent,fill,fill-opacity,fill-rule,filter,filterRes,filterUnits,flood-color,flood-opacity,font-family,font-size,font-size-adjust,font-stretch,font-style,font-variant,font-weight,format,from,fr,fx,fy,g1,g2,glyph-name,glyph-orientation-horizontal,glyph-orientation-vertical,glyphRef,gradientTransform,gradientUnits,hanging,height,href,hreflang,horiz-adv-x,horiz-origin-x,id,ideographic,image-rendering,in,in2,intercept,k,k1,k2,k3,k4,kernelMatrix,kernelUnitLength,kerning,keyPoints,keySplines,keyTimes,lang,lengthAdjust,letter-spacing,lighting-color,limitingConeAngle,local,marker-end,marker-mid,marker-start,markerHeight,markerUnits,markerWidth,mask,maskContentUnits,maskUnits,mathematical,max,media,method,min,mode,name,numOctaves,offset,opacity,operator,order,orient,orientation,origin,overflow,overline-position,overline-thickness,panose-1,paint-order,path,pathLength,patternContentUnits,patternTransform,patternUnits,ping,pointer-events,points,pointsAtX,pointsAtY,pointsAtZ,preserveAlpha,preserveAspectRatio,primitiveUnits,r,radius,referrerPolicy,refX,refY,rel,rendering-intent,repeatCount,repeatDur,requiredExtensions,requiredFeatures,restart,result,rotate,rx,ry,scale,seed,shape-rendering,slope,spacing,specularConstant,specularExponent,speed,spreadMethod,startOffset,stdDeviation,stemh,stemv,stitchTiles,stop-color,stop-opacity,strikethrough-position,strikethrough-thickness,string,stroke,stroke-dasharray,stroke-dashoffset,stroke-linecap,stroke-linejoin,stroke-miterlimit,stroke-opacity,stroke-width,style,surfaceScale,systemLanguage,tabindex,tableValues,target,targetX,targetY,text-anchor,text-decoration,text-rendering,textLength,to,transform,transform-origin,type,u1,u2,underline-position,underline-thickness,unicode,unicode-bidi,unicode-range,units-per-em,v-alphabetic,v-hanging,v-ideographic,v-mathematical,values,vector-effect,version,vert-adv-y,vert-origin-x,vert-origin-y,viewBox,viewTarget,visibility,width,widths,word-spacing,writing-mode,x,x-height,x1,x2,xChannelSelector,xlink:actuate,xlink:arcrole,xlink:href,xlink:role,xlink:show,xlink:title,xlink:type,xmlns:xlink,xml:base,xml:lang,xml:space,y,y1,y2,yChannelSelector,z,zoomAndPan`
      );
      var isKnownMathMLAttr = /* @__PURE__ */ makeMap(
        `accent,accentunder,actiontype,align,alignmentscope,altimg,altimg-height,altimg-valign,altimg-width,alttext,bevelled,close,columnsalign,columnlines,columnspan,denomalign,depth,dir,display,displaystyle,encoding,equalcolumns,equalrows,fence,fontstyle,fontweight,form,frame,framespacing,groupalign,height,href,id,indentalign,indentalignfirst,indentalignlast,indentshift,indentshiftfirst,indentshiftlast,indextype,justify,largetop,largeop,lquote,lspace,mathbackground,mathcolor,mathsize,mathvariant,maxsize,minlabelspacing,mode,other,overflow,position,rowalign,rowlines,rowspan,rquote,rspace,scriptlevel,scriptminsize,scriptsizemultiplier,selection,separator,separators,shift,side,src,stackalign,stretchy,subscriptshift,superscriptshift,symmetric,voffset,width,widths,xlink:href,xlink:show,xlink:type,xmlns`
      );
      function isRenderableAttrValue(value) {
        if (value == null) {
          return false;
        }
        const type = typeof value;
        return type === "string" || type === "number" || type === "boolean";
      }
      var escapeRE = /["'&<>]/;
      function escapeHtml(string) {
        const str = "" + string;
        const match = escapeRE.exec(str);
        if (!match) {
          return str;
        }
        let html = "";
        let escaped;
        let index;
        let lastIndex = 0;
        for (index = match.index; index < str.length; index++) {
          switch (str.charCodeAt(index)) {
            case 34:
              escaped = "&quot;";
              break;
            case 38:
              escaped = "&amp;";
              break;
            case 39:
              escaped = "&#39;";
              break;
            case 60:
              escaped = "&lt;";
              break;
            case 62:
              escaped = "&gt;";
              break;
            default:
              continue;
          }
          if (lastIndex !== index) {
            html += str.slice(lastIndex, index);
          }
          lastIndex = index + 1;
          html += escaped;
        }
        return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
      }
      var commentStripRE = /^(?:-?>)+|<!--|-->|--!>|<!-$/g;
      function escapeHtmlComment(src) {
        let prev;
        do {
          prev = src;
          src = src.replace(commentStripRE, "");
        } while (src !== prev);
        return src;
      }
      var cssVarNameEscapeSymbolsRE = /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
      function getEscapedCssVarName(key, doubleEscape) {
        return key.replace(
          cssVarNameEscapeSymbolsRE,
          (s) => doubleEscape ? s === '"' ? '\\\\\\"' : `\\\\${s}` : `\\${s}`
        );
      }
      function looseCompareArrays(a, b) {
        if (a.length !== b.length) return false;
        let equal = true;
        for (let i = 0; equal && i < a.length; i++) {
          equal = looseEqual(a[i], b[i]);
        }
        return equal;
      }
      function looseCompareCollections(a, b) {
        if (a.size !== b.size) return false;
        const candidates = Array.from(b);
        const matched = new Uint8Array(candidates.length);
        for (const item of a) {
          let index = -1;
          for (let i = 0; i < candidates.length; i++) {
            if (!matched[i] && looseEqual(item, candidates[i])) {
              index = i;
              break;
            }
          }
          if (index < 0) return false;
          matched[index] = 1;
        }
        return true;
      }
      function looseEqual(a, b) {
        if (a === b) return true;
        let aValidType = isDate(a);
        let bValidType = isDate(b);
        if (aValidType || bValidType) {
          return aValidType && bValidType ? a.getTime() === b.getTime() : false;
        }
        aValidType = isSymbol(a);
        bValidType = isSymbol(b);
        if (aValidType || bValidType) {
          return a === b;
        }
        aValidType = isArray(a);
        bValidType = isArray(b);
        if (aValidType || bValidType) {
          return aValidType && bValidType ? looseCompareArrays(a, b) : false;
        }
        aValidType = isObject(a);
        bValidType = isObject(b);
        if (aValidType || bValidType) {
          if (!aValidType || !bValidType) {
            return false;
          }
          aValidType = isMap(a);
          bValidType = isMap(b);
          if (aValidType || bValidType) {
            return aValidType && bValidType ? looseCompareCollections(a, b) : false;
          }
          aValidType = isSet(a);
          bValidType = isSet(b);
          if (aValidType || bValidType) {
            return aValidType && bValidType ? looseCompareCollections(a, b) : false;
          }
          const aKeysCount = Object.keys(a).length;
          const bKeysCount = Object.keys(b).length;
          if (aKeysCount !== bKeysCount) {
            return false;
          }
          for (const key in a) {
            const aHasKey = a.hasOwnProperty(key);
            const bHasKey = b.hasOwnProperty(key);
            if (aHasKey && !bHasKey || !aHasKey && bHasKey || !looseEqual(a[key], b[key])) {
              return false;
            }
          }
        }
        return String(a) === String(b);
      }
      function looseIndexOf(arr, val) {
        return arr.findIndex((item) => looseEqual(item, val));
      }
      var isRef = (val) => {
        return !!(val && val["__v_isRef"] === true);
      };
      var toDisplayString = (val) => {
        return isString(val) ? val : val == null ? "" : isArray(val) || isObject(val) && (val.toString === objectToString || !isFunction(val.toString)) ? isRef(val) ? toDisplayString(val.value) : JSON.stringify(val, replacer, 2) : String(val);
      };
      var replacer = (_key, val) => {
        if (isRef(val)) {
          return replacer(_key, val.value);
        } else if (isMap(val)) {
          return {
            [`Map(${val.size})`]: [...val.entries()].reduce(
              (entries, [key, val2], i) => {
                entries[stringifySymbol(key, i) + " =>"] = val2;
                return entries;
              },
              {}
            )
          };
        } else if (isSet(val)) {
          return {
            [`Set(${val.size})`]: [...val.values()].map((v) => stringifySymbol(v))
          };
        } else if (isSymbol(val)) {
          return stringifySymbol(val);
        } else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
          return String(val);
        }
        return val;
      };
      var stringifySymbol = (v, i = "") => {
        var _a;
        return (
          // Symbol.description in es2019+ so we need to cast here to pass
          // the lib: es2016 check
          isSymbol(v) ? `Symbol(${(_a = v.description) != null ? _a : i})` : v
        );
      };
      function normalizeCssVarValue(value) {
        if (value == null) {
          return "initial";
        }
        if (typeof value === "string") {
          return value === "" ? " " : value;
        }
        return String(value);
      }
      exports.EMPTY_ARR = EMPTY_ARR;
      exports.EMPTY_OBJ = EMPTY_OBJ;
      exports.NO = NO;
      exports.NOOP = NOOP;
      exports.PatchFlagNames = PatchFlagNames;
      exports.PatchFlags = PatchFlags;
      exports.ShapeFlags = ShapeFlags;
      exports.SlotFlags = SlotFlags;
      exports.camelize = camelize;
      exports.capitalize = capitalize;
      exports.cssVarNameEscapeSymbolsRE = cssVarNameEscapeSymbolsRE;
      exports.def = def;
      exports.escapeHtml = escapeHtml;
      exports.escapeHtmlComment = escapeHtmlComment;
      exports.extend = extend;
      exports.genCacheKey = genCacheKey;
      exports.genPropsAccessExp = genPropsAccessExp;
      exports.generateCodeFrame = generateCodeFrame;
      exports.getEscapedCssVarName = getEscapedCssVarName;
      exports.getGlobalThis = getGlobalThis;
      exports.hasChanged = hasChanged;
      exports.hasOwn = hasOwn;
      exports.hyphenate = hyphenate;
      exports.includeBooleanAttr = includeBooleanAttr;
      exports.invokeArrayFns = invokeArrayFns;
      exports.isArray = isArray;
      exports.isBooleanAttr = isBooleanAttr;
      exports.isBuiltInDirective = isBuiltInDirective;
      exports.isDate = isDate;
      exports.isFunction = isFunction;
      exports.isGloballyAllowed = isGloballyAllowed;
      exports.isGloballyWhitelisted = isGloballyWhitelisted;
      exports.isHTMLTag = isHTMLTag;
      exports.isIntegerKey = isIntegerKey;
      exports.isKnownHtmlAttr = isKnownHtmlAttr;
      exports.isKnownMathMLAttr = isKnownMathMLAttr;
      exports.isKnownSvgAttr = isKnownSvgAttr;
      exports.isMap = isMap;
      exports.isMathMLTag = isMathMLTag;
      exports.isModelListener = isModelListener;
      exports.isObject = isObject;
      exports.isOn = isOn;
      exports.isPlainObject = isPlainObject;
      exports.isPromise = isPromise;
      exports.isRegExp = isRegExp;
      exports.isRenderableAttrValue = isRenderableAttrValue;
      exports.isReservedProp = isReservedProp;
      exports.isSSRSafeAttrName = isSSRSafeAttrName;
      exports.isSVGTag = isSVGTag;
      exports.isSet = isSet;
      exports.isSpecialBooleanAttr = isSpecialBooleanAttr;
      exports.isString = isString;
      exports.isSymbol = isSymbol;
      exports.isVoidTag = isVoidTag;
      exports.looseEqual = looseEqual;
      exports.looseIndexOf = looseIndexOf;
      exports.looseToNumber = looseToNumber;
      exports.makeMap = makeMap;
      exports.normalizeClass = normalizeClass;
      exports.normalizeCssVarValue = normalizeCssVarValue;
      exports.normalizeProps = normalizeProps;
      exports.normalizeStyle = normalizeStyle;
      exports.objectToString = objectToString;
      exports.parseStringStyle = parseStringStyle;
      exports.propsToAttrMap = propsToAttrMap;
      exports.remove = remove;
      exports.slotFlagsText = slotFlagsText;
      exports.stringifyStyle = stringifyStyle;
      exports.toDisplayString = toDisplayString;
      exports.toHandlerKey = toHandlerKey;
      exports.toNumber = toNumber;
      exports.toRawType = toRawType;
      exports.toTypeString = toTypeString;
    }
  });

  // node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/index.js
  var require_shared = __commonJS({
    "node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/index.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_shared_cjs_prod();
      } else {
        module.exports = null;
      }
    }
  });

  // node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/dist/reactivity.cjs.prod.js
  var require_reactivity_cjs_prod = __commonJS({
    "node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/dist/reactivity.cjs.prod.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var shared = require_shared();
      var activeEffectScope;
      var EffectScope = class {
        // TODO isolatedDeclarations "__v_skip"
        constructor(detached = false) {
          this.detached = detached;
          this._active = true;
          this._on = 0;
          this.effects = [];
          this.cleanups = [];
          this._isPaused = false;
          this._warnOnRun = true;
          this.__v_skip = true;
          if (!detached && activeEffectScope) {
            if (activeEffectScope.active) {
              this.parent = activeEffectScope;
              this.index = (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
                this
              ) - 1;
            } else {
              this._active = false;
              this._warnOnRun = false;
            }
          }
        }
        get active() {
          return this._active;
        }
        pause() {
          if (this._active) {
            this._isPaused = true;
            let i, l;
            if (this.scopes) {
              const scopes = this.scopes.slice();
              for (i = 0, l = scopes.length; i < l; i++) {
                scopes[i].pause();
              }
            }
            for (i = 0, l = this.effects.length; i < l; i++) {
              this.effects[i].pause();
            }
          }
        }
        /**
         * Resumes the effect scope, including all child scopes and effects.
         */
        resume() {
          if (this._active) {
            if (this._isPaused) {
              this._isPaused = false;
              let i, l;
              if (this.scopes) {
                const scopes = this.scopes.slice();
                for (i = 0, l = scopes.length; i < l; i++) {
                  scopes[i].resume();
                }
              }
              const effects = this.effects.slice();
              for (i = 0, l = effects.length; i < l; i++) {
                effects[i].resume();
              }
            }
          }
        }
        run(fn) {
          if (this._active) {
            const currentEffectScope = activeEffectScope;
            try {
              activeEffectScope = this;
              return fn();
            } finally {
              activeEffectScope = currentEffectScope;
            }
          }
        }
        /**
         * This should only be called on non-detached scopes
         * @internal
         */
        on() {
          if (++this._on === 1) {
            this.prevScope = activeEffectScope;
            activeEffectScope = this;
          }
        }
        /**
         * This should only be called on non-detached scopes
         * @internal
         */
        off() {
          if (this._on > 0 && --this._on === 0) {
            if (activeEffectScope === this) {
              activeEffectScope = this.prevScope;
            } else {
              let current = activeEffectScope;
              while (current) {
                if (current.prevScope === this) {
                  current.prevScope = this.prevScope;
                  break;
                }
                current = current.prevScope;
              }
            }
            this.prevScope = void 0;
          }
        }
        stop(fromParent) {
          if (this._active) {
            this._active = false;
            let i, l;
            for (i = 0, l = this.effects.length; i < l; i++) {
              this.effects[i].stop();
            }
            this.effects.length = 0;
            for (i = 0, l = this.cleanups.length; i < l; i++) {
              this.cleanups[i]();
            }
            this.cleanups.length = 0;
            if (this.scopes) {
              const scopes = this.scopes.slice();
              for (i = 0, l = scopes.length; i < l; i++) {
                scopes[i].stop(true);
              }
              this.scopes.length = 0;
            }
            if (!this.detached && this.parent && !fromParent) {
              const last = this.parent.scopes.pop();
              if (last && last !== this) {
                this.parent.scopes[this.index] = last;
                last.index = this.index;
              }
            }
            this.parent = void 0;
          }
        }
      };
      function effectScope(detached) {
        return new EffectScope(detached);
      }
      function getCurrentScope() {
        return activeEffectScope;
      }
      function onScopeDispose(fn, failSilently = false) {
        if (activeEffectScope) {
          activeEffectScope.cleanups.push(fn);
        }
      }
      var activeSub;
      var EffectFlags = {
        "ACTIVE": 1,
        "1": "ACTIVE",
        "RUNNING": 2,
        "2": "RUNNING",
        "TRACKING": 4,
        "4": "TRACKING",
        "NOTIFIED": 8,
        "8": "NOTIFIED",
        "DIRTY": 16,
        "16": "DIRTY",
        "ALLOW_RECURSE": 32,
        "32": "ALLOW_RECURSE",
        "PAUSED": 64,
        "64": "PAUSED",
        "EVALUATED": 128,
        "128": "EVALUATED"
      };
      var pausedQueueEffects = /* @__PURE__ */ new WeakSet();
      var ReactiveEffect = class {
        constructor(fn) {
          this.fn = fn;
          this.deps = void 0;
          this.depsTail = void 0;
          this.flags = 1 | 4;
          this.next = void 0;
          this.cleanup = void 0;
          this.scheduler = void 0;
          if (activeEffectScope) {
            if (activeEffectScope.active) {
              activeEffectScope.effects.push(this);
            } else {
              this.flags &= -2;
            }
          }
        }
        pause() {
          this.flags |= 64;
        }
        resume() {
          if (this.flags & 64) {
            this.flags &= -65;
            if (pausedQueueEffects.has(this)) {
              pausedQueueEffects.delete(this);
              this.trigger();
            }
          }
        }
        /**
         * @internal
         */
        notify() {
          if (this.flags & 2 && !(this.flags & 32)) {
            return;
          }
          if (!(this.flags & 8)) {
            batch(this);
          }
        }
        run() {
          if (!(this.flags & 1)) {
            return this.fn();
          }
          this.flags |= 2;
          cleanupEffect(this);
          prepareDeps(this);
          const prevEffect = activeSub;
          const prevShouldTrack = shouldTrack;
          activeSub = this;
          shouldTrack = true;
          try {
            return this.fn();
          } finally {
            cleanupDeps(this);
            activeSub = prevEffect;
            shouldTrack = prevShouldTrack;
            this.flags &= -3;
          }
        }
        stop() {
          if (this.flags & 1) {
            for (let link = this.deps; link; link = link.nextDep) {
              removeSub(link);
            }
            this.deps = this.depsTail = void 0;
            cleanupEffect(this);
            this.onStop && this.onStop();
            this.flags &= -2;
          }
        }
        trigger() {
          if (this.flags & 64) {
            pausedQueueEffects.add(this);
          } else if (this.scheduler) {
            this.scheduler();
          } else {
            this.runIfDirty();
          }
        }
        /**
         * @internal
         */
        runIfDirty() {
          if (isDirty(this)) {
            this.run();
          }
        }
        get dirty() {
          return isDirty(this);
        }
      };
      var batchDepth = 0;
      var batchedSub;
      var batchedComputed;
      function batch(sub, isComputed = false) {
        sub.flags |= 8;
        if (isComputed) {
          sub.next = batchedComputed;
          batchedComputed = sub;
          return;
        }
        sub.next = batchedSub;
        batchedSub = sub;
      }
      function startBatch() {
        batchDepth++;
      }
      function endBatch() {
        if (--batchDepth > 0) {
          return;
        }
        if (batchedComputed) {
          let e = batchedComputed;
          batchedComputed = void 0;
          while (e) {
            const next = e.next;
            e.next = void 0;
            e.flags &= -9;
            e = next;
          }
        }
        let error;
        while (batchedSub) {
          let e = batchedSub;
          batchedSub = void 0;
          while (e) {
            const next = e.next;
            e.next = void 0;
            e.flags &= -9;
            if (e.flags & 1) {
              try {
                ;
                e.trigger();
              } catch (err) {
                if (!error) error = err;
              }
            }
            e = next;
          }
        }
        if (error) throw error;
      }
      function prepareDeps(sub) {
        for (let link = sub.deps; link; link = link.nextDep) {
          link.version = -1;
          link.prevActiveLink = link.dep.activeLink;
          link.dep.activeLink = link;
        }
      }
      function cleanupDeps(sub) {
        let head;
        let tail = sub.depsTail;
        let link = tail;
        while (link) {
          const prev = link.prevDep;
          if (link.version === -1) {
            if (link === tail) tail = prev;
            removeSub(link);
            removeDep(link);
          } else {
            head = link;
          }
          link.dep.activeLink = link.prevActiveLink;
          link.prevActiveLink = void 0;
          link = prev;
        }
        sub.deps = head;
        sub.depsTail = tail;
      }
      function isDirty(sub) {
        for (let link = sub.deps; link; link = link.nextDep) {
          if (link.dep.version !== link.version || link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version)) {
            return true;
          }
        }
        if (sub._dirty) {
          return true;
        }
        return false;
      }
      function refreshComputed(computed2) {
        if (computed2.flags & 4 && !(computed2.flags & 16)) {
          return;
        }
        computed2.flags &= -17;
        if (computed2.globalVersion === globalVersion) {
          return;
        }
        computed2.globalVersion = globalVersion;
        if (!computed2.isSSR && computed2.flags & 128 && (!computed2.deps && !computed2._dirty || !isDirty(computed2))) {
          return;
        }
        computed2.flags |= 2;
        const dep = computed2.dep;
        const prevSub = activeSub;
        const prevShouldTrack = shouldTrack;
        activeSub = computed2;
        shouldTrack = true;
        try {
          prepareDeps(computed2);
          const value = computed2.fn(computed2._value);
          if (dep.version === 0 || shared.hasChanged(value, computed2._value)) {
            computed2.flags |= 128;
            computed2._value = value;
            dep.version++;
          }
        } catch (err) {
          dep.version++;
          throw err;
        } finally {
          activeSub = prevSub;
          shouldTrack = prevShouldTrack;
          cleanupDeps(computed2);
          computed2.flags &= -3;
        }
      }
      function removeSub(link, soft = false) {
        const { dep, prevSub, nextSub } = link;
        if (prevSub) {
          prevSub.nextSub = nextSub;
          link.prevSub = void 0;
        }
        if (nextSub) {
          nextSub.prevSub = prevSub;
          link.nextSub = void 0;
        }
        if (dep.subs === link) {
          dep.subs = prevSub;
          if (!prevSub && dep.computed) {
            dep.computed.flags &= -5;
            for (let l = dep.computed.deps; l; l = l.nextDep) {
              removeSub(l, true);
            }
          }
        }
        if (!soft && !--dep.sc && dep.map) {
          dep.map.delete(dep.key);
        }
      }
      function removeDep(link) {
        const { prevDep, nextDep } = link;
        if (prevDep) {
          prevDep.nextDep = nextDep;
          link.prevDep = void 0;
        }
        if (nextDep) {
          nextDep.prevDep = prevDep;
          link.nextDep = void 0;
        }
      }
      function effect(fn, options) {
        if (fn.effect instanceof ReactiveEffect) {
          fn = fn.effect.fn;
        }
        const e = new ReactiveEffect(fn);
        if (options) {
          shared.extend(e, options);
        }
        try {
          e.run();
        } catch (err) {
          e.stop();
          throw err;
        }
        const runner = e.run.bind(e);
        runner.effect = e;
        return runner;
      }
      function stop(runner) {
        runner.effect.stop();
      }
      var shouldTrack = true;
      var trackStack = [];
      function pauseTracking() {
        trackStack.push(shouldTrack);
        shouldTrack = false;
      }
      function enableTracking() {
        trackStack.push(shouldTrack);
        shouldTrack = true;
      }
      function resetTracking() {
        const last = trackStack.pop();
        shouldTrack = last === void 0 ? true : last;
      }
      function onEffectCleanup(fn, failSilently = false) {
        if (activeSub instanceof ReactiveEffect) {
          activeSub.cleanup = fn;
        }
      }
      function cleanupEffect(e) {
        const { cleanup } = e;
        e.cleanup = void 0;
        if (cleanup) {
          const prevSub = activeSub;
          activeSub = void 0;
          try {
            cleanup();
          } finally {
            activeSub = prevSub;
          }
        }
      }
      var globalVersion = 0;
      var Link = class {
        constructor(sub, dep) {
          this.sub = sub;
          this.dep = dep;
          this.version = dep.version;
          this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
        }
      };
      var Dep = class {
        // TODO isolatedDeclarations "__v_skip"
        constructor(computed2) {
          this.computed = computed2;
          this.version = 0;
          this.activeLink = void 0;
          this.subs = void 0;
          this.map = void 0;
          this.key = void 0;
          this.sc = 0;
          this.__v_skip = true;
        }
        track(debugInfo) {
          if (!activeSub || !shouldTrack || activeSub === this.computed) {
            return;
          }
          let link = this.activeLink;
          if (link === void 0 || link.sub !== activeSub) {
            link = this.activeLink = new Link(activeSub, this);
            if (!activeSub.deps) {
              activeSub.deps = activeSub.depsTail = link;
            } else {
              link.prevDep = activeSub.depsTail;
              activeSub.depsTail.nextDep = link;
              activeSub.depsTail = link;
            }
            addSub(link);
          } else if (link.version === -1) {
            link.version = this.version;
            if (link.nextDep) {
              const next = link.nextDep;
              next.prevDep = link.prevDep;
              if (link.prevDep) {
                link.prevDep.nextDep = next;
              }
              link.prevDep = activeSub.depsTail;
              link.nextDep = void 0;
              activeSub.depsTail.nextDep = link;
              activeSub.depsTail = link;
              if (activeSub.deps === link) {
                activeSub.deps = next;
              }
            }
          }
          return link;
        }
        trigger(debugInfo) {
          this.version++;
          globalVersion++;
          this.notify(debugInfo);
        }
        notify(debugInfo) {
          startBatch();
          try {
            if (false) ;
            for (let link = this.subs; link; link = link.prevSub) {
              if (link.sub.notify()) {
                ;
                link.sub.dep.notify();
              }
            }
          } finally {
            endBatch();
          }
        }
      };
      function addSub(link) {
        link.dep.sc++;
        if (link.sub.flags & 4) {
          const computed2 = link.dep.computed;
          if (computed2 && !link.dep.subs) {
            computed2.flags |= 4 | 16;
            for (let l = computed2.deps; l; l = l.nextDep) {
              addSub(l);
            }
          }
          const currentTail = link.dep.subs;
          if (currentTail !== link) {
            link.prevSub = currentTail;
            if (currentTail) currentTail.nextSub = link;
          }
          link.dep.subs = link;
        }
      }
      var targetMap = /* @__PURE__ */ new WeakMap();
      var ITERATE_KEY = /* @__PURE__ */ Symbol(
        ""
      );
      var MAP_KEY_ITERATE_KEY = /* @__PURE__ */ Symbol(
        ""
      );
      var ARRAY_ITERATE_KEY = /* @__PURE__ */ Symbol(
        ""
      );
      function track(target, type, key) {
        if (shouldTrack && activeSub) {
          let depsMap = targetMap.get(target);
          if (!depsMap) {
            targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
          }
          let dep = depsMap.get(key);
          if (!dep) {
            depsMap.set(key, dep = new Dep());
            dep.map = depsMap;
            dep.key = key;
          }
          {
            dep.track();
          }
        }
      }
      function trigger(target, type, key, newValue, oldValue, oldTarget) {
        const depsMap = targetMap.get(target);
        if (!depsMap) {
          globalVersion++;
          return;
        }
        const run = (dep) => {
          if (dep) {
            {
              dep.trigger();
            }
          }
        };
        startBatch();
        if (type === "clear") {
          depsMap.forEach(run);
        } else {
          const targetIsArray = shared.isArray(target);
          const isArrayIndex = targetIsArray && shared.isIntegerKey(key);
          if (targetIsArray && key === "length") {
            const newLength = Number(newValue);
            depsMap.forEach((dep, key2) => {
              if (key2 === "length" || key2 === ARRAY_ITERATE_KEY || !shared.isSymbol(key2) && key2 >= newLength) {
                run(dep);
              }
            });
          } else {
            if (key !== void 0 || depsMap.has(void 0)) {
              run(depsMap.get(key));
            }
            if (isArrayIndex) {
              run(depsMap.get(ARRAY_ITERATE_KEY));
            }
            switch (type) {
              case "add":
                if (!targetIsArray) {
                  run(depsMap.get(ITERATE_KEY));
                  if (shared.isMap(target)) {
                    run(depsMap.get(MAP_KEY_ITERATE_KEY));
                  }
                } else if (isArrayIndex) {
                  run(depsMap.get("length"));
                }
                break;
              case "delete":
                if (!targetIsArray) {
                  run(depsMap.get(ITERATE_KEY));
                  if (shared.isMap(target)) {
                    run(depsMap.get(MAP_KEY_ITERATE_KEY));
                  }
                }
                break;
              case "set":
                if (shared.isMap(target)) {
                  run(depsMap.get(ITERATE_KEY));
                }
                break;
            }
          }
        }
        endBatch();
      }
      function getDepFromReactive(object, key) {
        const depMap = targetMap.get(object);
        return depMap && depMap.get(key);
      }
      function reactiveReadArray(array) {
        const raw = /* @__PURE__ */ toRaw(array);
        if (raw === array) return raw;
        track(raw, "iterate", ARRAY_ITERATE_KEY);
        return /* @__PURE__ */ isShallow(array) ? raw : raw.map(toReactive);
      }
      function shallowReadArray(arr) {
        track(arr = /* @__PURE__ */ toRaw(arr), "iterate", ARRAY_ITERATE_KEY);
        return arr;
      }
      function toWrapped(target, item) {
        if (/* @__PURE__ */ isReadonly(target)) {
          return /* @__PURE__ */ isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item);
        }
        return toReactive(item);
      }
      var arrayInstrumentations = {
        __proto__: null,
        [Symbol.iterator]() {
          return iterator(this, Symbol.iterator, (item) => toWrapped(this, item));
        },
        concat(...args) {
          return reactiveReadArray(this).concat(
            ...args.map((x) => shared.isArray(x) ? reactiveReadArray(x) : x)
          );
        },
        entries() {
          return iterator(this, "entries", (value) => {
            value[1] = toWrapped(this, value[1]);
            return value;
          });
        },
        every(fn, thisArg) {
          return apply(this, "every", fn, thisArg, void 0, arguments);
        },
        filter(fn, thisArg) {
          return apply(
            this,
            "filter",
            fn,
            thisArg,
            (v) => v.map((item) => toWrapped(this, item)),
            arguments
          );
        },
        find(fn, thisArg) {
          return apply(
            this,
            "find",
            fn,
            thisArg,
            (item) => toWrapped(this, item),
            arguments
          );
        },
        findIndex(fn, thisArg) {
          return apply(this, "findIndex", fn, thisArg, void 0, arguments);
        },
        findLast(fn, thisArg) {
          return apply(
            this,
            "findLast",
            fn,
            thisArg,
            (item) => toWrapped(this, item),
            arguments
          );
        },
        findLastIndex(fn, thisArg) {
          return apply(this, "findLastIndex", fn, thisArg, void 0, arguments);
        },
        // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
        forEach(fn, thisArg) {
          return apply(this, "forEach", fn, thisArg, void 0, arguments);
        },
        includes(...args) {
          return searchProxy(this, "includes", args);
        },
        indexOf(...args) {
          return searchProxy(this, "indexOf", args);
        },
        join(separator) {
          return reactiveReadArray(this).join(separator);
        },
        // keys() iterator only reads `length`, no optimization required
        lastIndexOf(...args) {
          return searchProxy(this, "lastIndexOf", args);
        },
        map(fn, thisArg) {
          return apply(this, "map", fn, thisArg, void 0, arguments);
        },
        pop() {
          return noTracking(this, "pop");
        },
        push(...args) {
          return noTracking(this, "push", args);
        },
        reduce(fn, ...args) {
          return reduce(this, "reduce", fn, args);
        },
        reduceRight(fn, ...args) {
          return reduce(this, "reduceRight", fn, args);
        },
        shift() {
          return noTracking(this, "shift");
        },
        // slice could use ARRAY_ITERATE but also seems to beg for range tracking
        some(fn, thisArg) {
          return apply(this, "some", fn, thisArg, void 0, arguments);
        },
        splice(...args) {
          return noTracking(this, "splice", args);
        },
        toReversed() {
          return reactiveReadArray(this).toReversed();
        },
        toSorted(comparer) {
          return reactiveReadArray(this).toSorted(comparer);
        },
        toSpliced(...args) {
          return reactiveReadArray(this).toSpliced(...args);
        },
        unshift(...args) {
          return noTracking(this, "unshift", args);
        },
        values() {
          return iterator(this, "values", (item) => toWrapped(this, item));
        }
      };
      function iterator(self2, method, wrapValue) {
        const arr = shallowReadArray(self2);
        const iter = arr[method]();
        if (arr !== self2 && !/* @__PURE__ */ isShallow(self2)) {
          iter._next = iter.next;
          iter.next = () => {
            const result = iter._next();
            if (!result.done) {
              result.value = wrapValue(result.value);
            }
            return result;
          };
        }
        return iter;
      }
      var arrayProto = Array.prototype;
      function apply(self2, method, fn, thisArg, wrappedRetFn, args) {
        const arr = shallowReadArray(self2);
        const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
        const methodFn = arr[method];
        if (methodFn !== arrayProto[method]) {
          const result2 = methodFn.apply(self2, args);
          return needsWrap ? toReactive(result2) : result2;
        }
        let wrappedFn = fn;
        if (arr !== self2) {
          if (needsWrap) {
            wrappedFn = function(item, index) {
              return fn.call(this, toWrapped(self2, item), index, self2);
            };
          } else if (fn.length > 2) {
            wrappedFn = function(item, index) {
              return fn.call(this, item, index, self2);
            };
          }
        }
        const result = methodFn.call(arr, wrappedFn, thisArg);
        return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result;
      }
      function reduce(self2, method, fn, args) {
        const arr = shallowReadArray(self2);
        const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
        let wrappedFn = fn;
        let wrapInitialAccumulator = false;
        if (arr !== self2) {
          if (needsWrap) {
            wrapInitialAccumulator = args.length === 0;
            wrappedFn = function(acc, item, index) {
              if (wrapInitialAccumulator) {
                wrapInitialAccumulator = false;
                acc = toWrapped(self2, acc);
              }
              return fn.call(this, acc, toWrapped(self2, item), index, self2);
            };
          } else if (fn.length > 3) {
            wrappedFn = function(acc, item, index) {
              return fn.call(this, acc, item, index, self2);
            };
          }
        }
        const result = arr[method](wrappedFn, ...args);
        return wrapInitialAccumulator ? toWrapped(self2, result) : result;
      }
      function searchProxy(self2, method, args) {
        const arr = /* @__PURE__ */ toRaw(self2);
        track(arr, "iterate", ARRAY_ITERATE_KEY);
        const res = arr[method](...args);
        if ((res === -1 || res === false) && /* @__PURE__ */ isProxy(args[0])) {
          args[0] = /* @__PURE__ */ toRaw(args[0]);
          return arr[method](...args);
        }
        return res;
      }
      function noTracking(self2, method, args = []) {
        pauseTracking();
        startBatch();
        const res = (/* @__PURE__ */ toRaw(self2))[method].apply(self2, args);
        endBatch();
        resetTracking();
        return res;
      }
      var isNonTrackableKeys = /* @__PURE__ */ shared.makeMap(`__proto__,__v_isRef,__isVue`);
      var builtInSymbols = new Set(
        /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((key) => key !== "arguments" && key !== "caller").map((key) => Symbol[key]).filter(shared.isSymbol)
      );
      function hasOwnProperty(key) {
        if (!shared.isSymbol(key)) key = String(key);
        const obj = /* @__PURE__ */ toRaw(this);
        track(obj, "has", key);
        return obj.hasOwnProperty(key);
      }
      var BaseReactiveHandler = class {
        constructor(_isReadonly = false, _isShallow = false) {
          this._isReadonly = _isReadonly;
          this._isShallow = _isShallow;
        }
        get(target, key, receiver) {
          if (key === "__v_skip") return target["__v_skip"];
          const isReadonly2 = this._isReadonly, isShallow2 = this._isShallow;
          if (key === "__v_isReactive") {
            return !isReadonly2;
          } else if (key === "__v_isReadonly") {
            return isReadonly2;
          } else if (key === "__v_isShallow") {
            return isShallow2;
          } else if (key === "__v_raw") {
            if (receiver === (isReadonly2 ? isShallow2 ? shallowReadonlyMap : readonlyMap : isShallow2 ? shallowReactiveMap : reactiveMap).get(target) || // receiver is not the reactive proxy, but has the same prototype
            // this means the receiver is a user proxy of the reactive proxy
            Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)) {
              return target;
            }
            return;
          }
          const targetIsArray = shared.isArray(target);
          if (!isReadonly2) {
            let fn;
            if (targetIsArray && (fn = arrayInstrumentations[key])) {
              return fn;
            }
            if (key === "hasOwnProperty") {
              return hasOwnProperty;
            }
          }
          const res = Reflect.get(
            target,
            key,
            // if this is a proxy wrapping a ref, return methods using the raw ref
            // as receiver so that we don't have to call `toRaw` on the ref in all
            // its class methods
            /* @__PURE__ */ isRef(target) ? target : receiver
          );
          if (shared.isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
            return res;
          }
          if (!isReadonly2) {
            track(target, "get", key);
          }
          if (isShallow2) {
            return res;
          }
          if (/* @__PURE__ */ isRef(res)) {
            const value = targetIsArray && shared.isIntegerKey(key) ? res : res.value;
            return isReadonly2 && shared.isObject(value) ? /* @__PURE__ */ readonly(value) : value;
          }
          if (shared.isObject(res)) {
            return isReadonly2 ? /* @__PURE__ */ readonly(res) : /* @__PURE__ */ reactive(res);
          }
          return res;
        }
      };
      var MutableReactiveHandler = class extends BaseReactiveHandler {
        constructor(isShallow2 = false) {
          super(false, isShallow2);
        }
        set(target, key, value, receiver) {
          let oldValue = target[key];
          const isArrayWithIntegerKey = shared.isArray(target) && shared.isIntegerKey(key);
          if (!this._isShallow) {
            const isOldValueReadonly = /* @__PURE__ */ isReadonly(oldValue);
            if (!/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
              oldValue = /* @__PURE__ */ toRaw(oldValue);
              value = /* @__PURE__ */ toRaw(value);
            }
            if (!isArrayWithIntegerKey && /* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
              if (isOldValueReadonly) {
                return true;
              } else {
                oldValue.value = value;
                return true;
              }
            }
          }
          const hadKey = isArrayWithIntegerKey ? Number(key) < target.length : shared.hasOwn(target, key);
          const result = Reflect.set(
            target,
            key,
            value,
            /* @__PURE__ */ isRef(target) ? target : receiver
          );
          if (target === /* @__PURE__ */ toRaw(receiver) && result) {
            if (!hadKey) {
              trigger(target, "add", key, value);
            } else if (shared.hasChanged(value, oldValue)) {
              trigger(target, "set", key, value);
            }
          }
          return result;
        }
        deleteProperty(target, key) {
          const hadKey = shared.hasOwn(target, key);
          target[key];
          const result = Reflect.deleteProperty(target, key);
          if (result && hadKey) {
            trigger(target, "delete", key, void 0);
          }
          return result;
        }
        has(target, key) {
          const result = Reflect.has(target, key);
          if (!shared.isSymbol(key) || !builtInSymbols.has(key)) {
            track(target, "has", key);
          }
          return result;
        }
        ownKeys(target) {
          track(
            target,
            "iterate",
            shared.isArray(target) ? "length" : ITERATE_KEY
          );
          return Reflect.ownKeys(target);
        }
      };
      var ReadonlyReactiveHandler = class extends BaseReactiveHandler {
        constructor(isShallow2 = false) {
          super(true, isShallow2);
        }
        set(target, key) {
          return true;
        }
        deleteProperty(target, key) {
          return true;
        }
      };
      var mutableHandlers = /* @__PURE__ */ new MutableReactiveHandler();
      var readonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler();
      var shallowReactiveHandlers = /* @__PURE__ */ new MutableReactiveHandler(true);
      var shallowReadonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler(true);
      var toShallow = (value) => value;
      var getProto = (v) => Reflect.getPrototypeOf(v);
      function createIterableMethod(method, isReadonly2, isShallow2) {
        return function(...args) {
          const target = this["__v_raw"];
          const rawTarget = /* @__PURE__ */ toRaw(target);
          const targetIsMap = shared.isMap(rawTarget);
          const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
          const isKeyOnly = method === "keys" && targetIsMap;
          const innerIterator = target[method](...args);
          const wrap = isShallow2 ? toShallow : isReadonly2 ? toReadonly : toReactive;
          !isReadonly2 && track(
            rawTarget,
            "iterate",
            isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
          );
          return shared.extend(
            // inheriting all iterator properties
            Object.create(innerIterator),
            {
              // iterator protocol
              next() {
                const { value, done } = innerIterator.next();
                return done ? { value, done } : {
                  value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
                  done
                };
              }
            }
          );
        };
      }
      function createReadonlyMethod(type) {
        return function(...args) {
          return type === "delete" ? false : type === "clear" ? void 0 : this;
        };
      }
      function createInstrumentations(readonly2, shallow) {
        const instrumentations = {
          get(key) {
            const target = this["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const rawKey = /* @__PURE__ */ toRaw(key);
            if (!readonly2) {
              if (shared.hasChanged(key, rawKey)) {
                track(rawTarget, "get", key);
              }
              track(rawTarget, "get", rawKey);
            }
            const { has } = getProto(rawTarget);
            const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
            if (has.call(rawTarget, key)) {
              return wrap(target.get(key));
            } else if (has.call(rawTarget, rawKey)) {
              return wrap(target.get(rawKey));
            } else if (target !== rawTarget) {
              target.get(key);
            }
          },
          get size() {
            const target = this["__v_raw"];
            !readonly2 && track(/* @__PURE__ */ toRaw(target), "iterate", ITERATE_KEY);
            return target.size;
          },
          has(key) {
            const target = this["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const rawKey = /* @__PURE__ */ toRaw(key);
            if (!readonly2) {
              if (shared.hasChanged(key, rawKey)) {
                track(rawTarget, "has", key);
              }
              track(rawTarget, "has", rawKey);
            }
            return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
          },
          forEach(callback, thisArg) {
            const observed = this;
            const target = observed["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
            !readonly2 && track(rawTarget, "iterate", ITERATE_KEY);
            return target.forEach((value, key) => {
              return callback.call(thisArg, wrap(value), wrap(key), observed);
            });
          }
        };
        shared.extend(
          instrumentations,
          readonly2 ? {
            add: createReadonlyMethod("add"),
            set: createReadonlyMethod("set"),
            delete: createReadonlyMethod("delete"),
            clear: createReadonlyMethod("clear")
          } : {
            add(value) {
              const target = /* @__PURE__ */ toRaw(this);
              const proto = getProto(target);
              const rawValue = /* @__PURE__ */ toRaw(value);
              const valueToAdd = !shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value) ? rawValue : value;
              const hadKey = proto.has.call(target, valueToAdd) || shared.hasChanged(value, valueToAdd) && proto.has.call(target, value) || shared.hasChanged(rawValue, valueToAdd) && proto.has.call(target, rawValue);
              if (!hadKey) {
                target.add(valueToAdd);
                trigger(target, "add", valueToAdd, valueToAdd);
              }
              return this;
            },
            set(key, value) {
              if (!shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
                value = /* @__PURE__ */ toRaw(value);
              }
              const target = /* @__PURE__ */ toRaw(this);
              const { has, get } = getProto(target);
              let hadKey = has.call(target, key);
              if (!hadKey) {
                key = /* @__PURE__ */ toRaw(key);
                hadKey = has.call(target, key);
              }
              const oldValue = get.call(target, key);
              target.set(key, value);
              if (!hadKey) {
                trigger(target, "add", key, value);
              } else if (shared.hasChanged(value, oldValue)) {
                trigger(target, "set", key, value);
              }
              return this;
            },
            delete(key) {
              const target = /* @__PURE__ */ toRaw(this);
              const { has, get } = getProto(target);
              let hadKey = has.call(target, key);
              if (!hadKey) {
                key = /* @__PURE__ */ toRaw(key);
                hadKey = has.call(target, key);
              }
              get ? get.call(target, key) : void 0;
              const result = target.delete(key);
              if (hadKey) {
                trigger(target, "delete", key, void 0);
              }
              return result;
            },
            clear() {
              const target = /* @__PURE__ */ toRaw(this);
              const hadItems = target.size !== 0;
              const result = target.clear();
              if (hadItems) {
                trigger(
                  target,
                  "clear",
                  void 0,
                  void 0
                );
              }
              return result;
            }
          }
        );
        const iteratorMethods = [
          "keys",
          "values",
          "entries",
          Symbol.iterator
        ];
        iteratorMethods.forEach((method) => {
          instrumentations[method] = createIterableMethod(method, readonly2, shallow);
        });
        return instrumentations;
      }
      function createInstrumentationGetter(isReadonly2, shallow) {
        const instrumentations = createInstrumentations(isReadonly2, shallow);
        return (target, key, receiver) => {
          if (key === "__v_isReactive") {
            return !isReadonly2;
          } else if (key === "__v_isReadonly") {
            return isReadonly2;
          } else if (key === "__v_raw") {
            return target;
          }
          return Reflect.get(
            shared.hasOwn(instrumentations, key) && key in target ? instrumentations : target,
            key,
            receiver
          );
        };
      }
      var mutableCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(false, false)
      };
      var shallowCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(false, true)
      };
      var readonlyCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(true, false)
      };
      var shallowReadonlyCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(true, true)
      };
      var reactiveMap = /* @__PURE__ */ new WeakMap();
      var shallowReactiveMap = /* @__PURE__ */ new WeakMap();
      var readonlyMap = /* @__PURE__ */ new WeakMap();
      var shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
      function targetTypeMap(rawType) {
        switch (rawType) {
          case "Object":
          case "Array":
            return 1;
          case "Map":
          case "Set":
          case "WeakMap":
          case "WeakSet":
            return 2;
          default:
            return 0;
        }
      }
      // @__NO_SIDE_EFFECTS__
      function reactive(target) {
        if (/* @__PURE__ */ isReadonly(target)) {
          return target;
        }
        return createReactiveObject(
          target,
          false,
          mutableHandlers,
          mutableCollectionHandlers,
          reactiveMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function shallowReactive(target) {
        return createReactiveObject(
          target,
          false,
          shallowReactiveHandlers,
          shallowCollectionHandlers,
          shallowReactiveMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function readonly(target) {
        return createReactiveObject(
          target,
          true,
          readonlyHandlers,
          readonlyCollectionHandlers,
          readonlyMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function shallowReadonly2(target) {
        return createReactiveObject(
          target,
          true,
          shallowReadonlyHandlers,
          shallowReadonlyCollectionHandlers,
          shallowReadonlyMap
        );
      }
      function createReactiveObject(target, isReadonly2, baseHandlers, collectionHandlers, proxyMap) {
        if (!shared.isObject(target)) {
          return target;
        }
        if (target["__v_raw"] && !(isReadonly2 && target["__v_isReactive"])) {
          return target;
        }
        if (target["__v_skip"] || !Object.isExtensible(target)) {
          return target;
        }
        const existingProxy = proxyMap.get(target);
        if (existingProxy) {
          return existingProxy;
        }
        const targetType = targetTypeMap(shared.toRawType(target));
        if (targetType === 0) {
          return target;
        }
        const proxy = new Proxy(
          target,
          targetType === 2 ? collectionHandlers : baseHandlers
        );
        proxyMap.set(target, proxy);
        return proxy;
      }
      // @__NO_SIDE_EFFECTS__
      function isReactive(value) {
        if (/* @__PURE__ */ isReadonly(value)) {
          return /* @__PURE__ */ isReactive(value["__v_raw"]);
        }
        return !!(value && value["__v_isReactive"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isReadonly(value) {
        return !!(value && value["__v_isReadonly"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isShallow(value) {
        return !!(value && value["__v_isShallow"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isProxy(value) {
        return value ? !!value["__v_raw"] : false;
      }
      // @__NO_SIDE_EFFECTS__
      function toRaw(observed) {
        const raw = observed && observed["__v_raw"];
        return raw ? /* @__PURE__ */ toRaw(raw) : observed;
      }
      function markRaw(value) {
        if (!shared.hasOwn(value, "__v_skip") && Object.isExtensible(value)) {
          shared.def(value, "__v_skip", true);
        }
        return value;
      }
      var toReactive = (value) => shared.isObject(value) ? /* @__PURE__ */ reactive(value) : value;
      var toReadonly = (value) => shared.isObject(value) ? /* @__PURE__ */ readonly(value) : value;
      // @__NO_SIDE_EFFECTS__
      function isRef(r) {
        return r ? r["__v_isRef"] === true : false;
      }
      // @__NO_SIDE_EFFECTS__
      function ref2(value) {
        return createRef(value, false);
      }
      // @__NO_SIDE_EFFECTS__
      function shallowRef(value) {
        return createRef(value, true);
      }
      function createRef(rawValue, shallow) {
        if (/* @__PURE__ */ isRef(rawValue)) {
          return rawValue;
        }
        return new RefImpl(rawValue, shallow);
      }
      var RefImpl = class {
        constructor(value, isShallow2) {
          this.dep = new Dep();
          this["__v_isRef"] = true;
          this["__v_isShallow"] = false;
          this._rawValue = isShallow2 ? value : /* @__PURE__ */ toRaw(value);
          this._value = isShallow2 ? value : toReactive(value);
          this["__v_isShallow"] = isShallow2;
        }
        get value() {
          {
            this.dep.track();
          }
          return this._value;
        }
        set value(newValue) {
          const oldValue = this._rawValue;
          const useDirectValue = this["__v_isShallow"] || /* @__PURE__ */ isShallow(newValue) || /* @__PURE__ */ isReadonly(newValue);
          newValue = useDirectValue ? newValue : /* @__PURE__ */ toRaw(newValue);
          if (shared.hasChanged(newValue, oldValue)) {
            this._rawValue = newValue;
            this._value = useDirectValue ? newValue : toReactive(newValue);
            {
              this.dep.trigger();
            }
          }
        }
      };
      function triggerRef(ref22) {
        if (ref22.dep) {
          {
            ref22.dep.trigger();
          }
        }
      }
      function unref(ref22) {
        return /* @__PURE__ */ isRef(ref22) ? ref22.value : ref22;
      }
      function toValue(source) {
        return shared.isFunction(source) ? source() : unref(source);
      }
      var shallowUnwrapHandlers = {
        get: (target, key, receiver) => key === "__v_raw" ? target : unref(Reflect.get(target, key, receiver)),
        set: (target, key, value, receiver) => {
          const oldValue = target[key];
          if (/* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
            oldValue.value = value;
            return true;
          } else {
            return Reflect.set(target, key, value, receiver);
          }
        }
      };
      function proxyRefs(objectWithRefs) {
        return /* @__PURE__ */ isReactive(objectWithRefs) ? objectWithRefs : new Proxy(objectWithRefs, shallowUnwrapHandlers);
      }
      var CustomRefImpl = class {
        constructor(factory) {
          this["__v_isRef"] = true;
          this._value = void 0;
          const dep = this.dep = new Dep();
          const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep));
          this._get = get;
          this._set = set;
        }
        get value() {
          return this._value = this._get();
        }
        set value(newVal) {
          this._set(newVal);
        }
      };
      function customRef(factory) {
        return new CustomRefImpl(factory);
      }
      // @__NO_SIDE_EFFECTS__
      function toRefs(object) {
        const ret = shared.isArray(object) ? new Array(object.length) : {};
        for (const key in object) {
          ret[key] = propertyToRef(object, key);
        }
        return ret;
      }
      var ObjectRefImpl = class {
        constructor(_object, key, _defaultValue) {
          this._object = _object;
          this._defaultValue = _defaultValue;
          this["__v_isRef"] = true;
          this._value = void 0;
          this._key = shared.isSymbol(key) ? key : String(key);
          this._raw = /* @__PURE__ */ toRaw(_object);
          let shallow = true;
          let obj = _object;
          if (!shared.isArray(_object) || shared.isSymbol(this._key) || !shared.isIntegerKey(this._key)) {
            do {
              shallow = !/* @__PURE__ */ isProxy(obj) || /* @__PURE__ */ isShallow(obj);
            } while (shallow && (obj = obj["__v_raw"]));
          }
          this._shallow = shallow;
        }
        get value() {
          let val = this._object[this._key];
          if (this._shallow) {
            val = unref(val);
          }
          return this._value = val === void 0 ? this._defaultValue : val;
        }
        set value(newVal) {
          if (this._shallow && /* @__PURE__ */ isRef(this._raw[this._key])) {
            const nestedRef = this._object[this._key];
            if (/* @__PURE__ */ isRef(nestedRef)) {
              nestedRef.value = newVal;
              return;
            }
          }
          this._object[this._key] = newVal;
        }
        get dep() {
          return getDepFromReactive(this._raw, this._key);
        }
      };
      var GetterRefImpl = class {
        constructor(_getter) {
          this._getter = _getter;
          this["__v_isRef"] = true;
          this["__v_isReadonly"] = true;
          this._value = void 0;
        }
        get value() {
          return this._value = this._getter();
        }
      };
      // @__NO_SIDE_EFFECTS__
      function toRef(source, key, defaultValue) {
        if (/* @__PURE__ */ isRef(source)) {
          return source;
        } else if (shared.isFunction(source)) {
          return new GetterRefImpl(source);
        } else if (shared.isObject(source) && arguments.length > 1) {
          return propertyToRef(source, key, defaultValue);
        } else {
          return /* @__PURE__ */ ref2(source);
        }
      }
      function propertyToRef(source, key, defaultValue) {
        return new ObjectRefImpl(source, key, defaultValue);
      }
      var ComputedRefImpl = class {
        constructor(fn, setter, isSSR) {
          this.fn = fn;
          this.setter = setter;
          this._value = void 0;
          this.dep = new Dep(this);
          this.__v_isRef = true;
          this.deps = void 0;
          this.depsTail = void 0;
          this.flags = 16;
          this.globalVersion = globalVersion - 1;
          this.next = void 0;
          this.effect = this;
          this["__v_isReadonly"] = !setter;
          this.isSSR = isSSR;
        }
        /**
         * @internal
         */
        notify() {
          this.flags |= 16;
          if (!(this.flags & 8) && // avoid infinite self recursion
          activeSub !== this) {
            batch(this, true);
            return true;
          }
        }
        get value() {
          const link = this.dep.track();
          refreshComputed(this);
          if (link) {
            link.version = this.dep.version;
          }
          return this._value;
        }
        set value(newValue) {
          if (this.setter) {
            this.setter(newValue);
          }
        }
      };
      // @__NO_SIDE_EFFECTS__
      function computed(getterOrOptions, debugOptions, isSSR = false) {
        let getter;
        let setter;
        if (shared.isFunction(getterOrOptions)) {
          getter = getterOrOptions;
        } else {
          getter = getterOrOptions.get;
          setter = getterOrOptions.set;
        }
        const cRef = new ComputedRefImpl(getter, setter, isSSR);
        return cRef;
      }
      var TrackOpTypes = {
        "GET": "get",
        "HAS": "has",
        "ITERATE": "iterate"
      };
      var TriggerOpTypes = {
        "SET": "set",
        "ADD": "add",
        "DELETE": "delete",
        "CLEAR": "clear"
      };
      var ReactiveFlags = {
        "SKIP": "__v_skip",
        "IS_REACTIVE": "__v_isReactive",
        "IS_READONLY": "__v_isReadonly",
        "IS_SHALLOW": "__v_isShallow",
        "RAW": "__v_raw",
        "IS_REF": "__v_isRef"
      };
      var WatchErrorCodes = {
        "WATCH_GETTER": 2,
        "2": "WATCH_GETTER",
        "WATCH_CALLBACK": 3,
        "3": "WATCH_CALLBACK",
        "WATCH_CLEANUP": 4,
        "4": "WATCH_CLEANUP"
      };
      var INITIAL_WATCHER_VALUE = {};
      var cleanupMap = /* @__PURE__ */ new WeakMap();
      var activeWatcher = void 0;
      function getCurrentWatcher() {
        return activeWatcher;
      }
      function onWatcherCleanup(cleanupFn, failSilently = false, owner = activeWatcher) {
        if (owner) {
          let cleanups = cleanupMap.get(owner);
          if (!cleanups) cleanupMap.set(owner, cleanups = []);
          cleanups.push(cleanupFn);
        }
      }
      function watch(source, cb, options = shared.EMPTY_OBJ) {
        const { immediate, deep, once, scheduler, augmentJob, call } = options;
        const reactiveGetter = (source2) => {
          if (deep) return source2;
          if (/* @__PURE__ */ isShallow(source2) || deep === false || deep === 0)
            return traverse(source2, 1);
          return traverse(source2);
        };
        let effect2;
        let getter;
        let cleanup;
        let boundCleanup;
        let forceTrigger = false;
        let isMultiSource = false;
        if (/* @__PURE__ */ isRef(source)) {
          getter = () => source.value;
          forceTrigger = /* @__PURE__ */ isShallow(source);
        } else if (/* @__PURE__ */ isReactive(source)) {
          getter = () => reactiveGetter(source);
          forceTrigger = true;
        } else if (shared.isArray(source)) {
          isMultiSource = true;
          forceTrigger = source.some((s) => /* @__PURE__ */ isReactive(s) || /* @__PURE__ */ isShallow(s));
          getter = () => source.map((s) => {
            if (/* @__PURE__ */ isRef(s)) {
              return s.value;
            } else if (/* @__PURE__ */ isReactive(s)) {
              return reactiveGetter(s);
            } else if (shared.isFunction(s)) {
              return call ? call(s, 2) : s();
            } else ;
          });
        } else if (shared.isFunction(source)) {
          if (cb) {
            getter = call ? () => call(source, 2) : source;
          } else {
            getter = () => {
              if (cleanup) {
                pauseTracking();
                try {
                  cleanup();
                } finally {
                  resetTracking();
                }
              }
              const currentEffect = activeWatcher;
              activeWatcher = effect2;
              try {
                return call ? call(source, 3, [boundCleanup]) : source(boundCleanup);
              } finally {
                activeWatcher = currentEffect;
              }
            };
          }
        } else {
          getter = shared.NOOP;
        }
        if (cb && deep) {
          const baseGetter = getter;
          const depth = deep === true ? Infinity : deep;
          getter = () => traverse(baseGetter(), depth);
        }
        const scope = getCurrentScope();
        const watchHandle = () => {
          effect2.stop();
          if (scope && scope.active) {
            shared.remove(scope.effects, effect2);
          }
        };
        if (once && cb) {
          const _cb = cb;
          cb = (...args) => {
            const res = _cb(...args);
            watchHandle();
            return res;
          };
        }
        let oldValue = isMultiSource ? new Array(source.length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE;
        const job = (immediateFirstRun) => {
          if (!(effect2.flags & 1) || !effect2.dirty && !immediateFirstRun) {
            return;
          }
          if (cb) {
            const newValue = effect2.run();
            if (immediateFirstRun || deep || forceTrigger || (isMultiSource ? newValue.some((v, i) => shared.hasChanged(v, oldValue[i])) : shared.hasChanged(newValue, oldValue))) {
              if (cleanup) {
                cleanup();
              }
              const currentWatcher = activeWatcher;
              activeWatcher = effect2;
              try {
                const args = [
                  newValue,
                  // pass undefined as the old value when it's changed for the first time
                  oldValue === INITIAL_WATCHER_VALUE ? void 0 : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE ? [] : oldValue,
                  boundCleanup
                ];
                oldValue = newValue;
                call ? call(cb, 3, args) : (
                  // @ts-expect-error
                  cb(...args)
                );
              } finally {
                activeWatcher = currentWatcher;
              }
            }
          } else {
            effect2.run();
          }
        };
        if (augmentJob) {
          augmentJob(job);
        }
        effect2 = new ReactiveEffect(getter);
        effect2.scheduler = scheduler ? () => scheduler(job, false) : job;
        boundCleanup = (fn) => onWatcherCleanup(fn, false, effect2);
        cleanup = effect2.onStop = () => {
          const cleanups = cleanupMap.get(effect2);
          if (cleanups) {
            if (call) {
              call(cleanups, 4);
            } else {
              for (const cleanup2 of cleanups) cleanup2();
            }
            cleanupMap.delete(effect2);
          }
        };
        if (cb) {
          if (immediate) {
            job(true);
          } else {
            oldValue = effect2.run();
          }
        } else if (scheduler) {
          scheduler(job.bind(null, true), true);
        } else {
          effect2.run();
        }
        watchHandle.pause = effect2.pause.bind(effect2);
        watchHandle.resume = effect2.resume.bind(effect2);
        watchHandle.stop = watchHandle;
        return watchHandle;
      }
      function traverse(value, depth = Infinity, seen) {
        if (depth <= 0 || !shared.isObject(value) || value["__v_skip"]) {
          return value;
        }
        seen = seen || /* @__PURE__ */ new Map();
        if ((seen.get(value) || 0) >= depth) {
          return value;
        }
        seen.set(value, depth);
        depth--;
        if (/* @__PURE__ */ isRef(value)) {
          traverse(value.value, depth, seen);
        } else if (shared.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            traverse(value[i], depth, seen);
          }
        } else if (shared.isSet(value) || shared.isMap(value)) {
          value.forEach((v) => {
            traverse(v, depth, seen);
          });
        } else if (shared.isPlainObject(value)) {
          for (const key in value) {
            traverse(value[key], depth, seen);
          }
          for (const key of Object.getOwnPropertySymbols(value)) {
            if (Object.prototype.propertyIsEnumerable.call(value, key)) {
              traverse(value[key], depth, seen);
            }
          }
        }
        return value;
      }
      exports.ARRAY_ITERATE_KEY = ARRAY_ITERATE_KEY;
      exports.EffectFlags = EffectFlags;
      exports.EffectScope = EffectScope;
      exports.ITERATE_KEY = ITERATE_KEY;
      exports.MAP_KEY_ITERATE_KEY = MAP_KEY_ITERATE_KEY;
      exports.ReactiveEffect = ReactiveEffect;
      exports.ReactiveFlags = ReactiveFlags;
      exports.TrackOpTypes = TrackOpTypes;
      exports.TriggerOpTypes = TriggerOpTypes;
      exports.WatchErrorCodes = WatchErrorCodes;
      exports.computed = computed;
      exports.customRef = customRef;
      exports.effect = effect;
      exports.effectScope = effectScope;
      exports.enableTracking = enableTracking;
      exports.getCurrentScope = getCurrentScope;
      exports.getCurrentWatcher = getCurrentWatcher;
      exports.isProxy = isProxy;
      exports.isReactive = isReactive;
      exports.isReadonly = isReadonly;
      exports.isRef = isRef;
      exports.isShallow = isShallow;
      exports.markRaw = markRaw;
      exports.onEffectCleanup = onEffectCleanup;
      exports.onScopeDispose = onScopeDispose;
      exports.onWatcherCleanup = onWatcherCleanup;
      exports.pauseTracking = pauseTracking;
      exports.proxyRefs = proxyRefs;
      exports.reactive = reactive;
      exports.reactiveReadArray = reactiveReadArray;
      exports.readonly = readonly;
      exports.ref = ref2;
      exports.resetTracking = resetTracking;
      exports.shallowReactive = shallowReactive;
      exports.shallowReadArray = shallowReadArray;
      exports.shallowReadonly = shallowReadonly2;
      exports.shallowRef = shallowRef;
      exports.stop = stop;
      exports.toRaw = toRaw;
      exports.toReactive = toReactive;
      exports.toReadonly = toReadonly;
      exports.toRef = toRef;
      exports.toRefs = toRefs;
      exports.toValue = toValue;
      exports.track = track;
      exports.traverse = traverse;
      exports.trigger = trigger;
      exports.triggerRef = triggerRef;
      exports.unref = unref;
      exports.watch = watch;
    }
  });

  // node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/index.js
  var require_reactivity = __commonJS({
    "node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/index.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_reactivity_cjs_prod();
      } else {
        module.exports = null;
      }
    }
  });

  // node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/dist/runtime-core.cjs.prod.js
  var require_runtime_core_cjs_prod = __commonJS({
    "node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/dist/runtime-core.cjs.prod.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var reactivity = require_reactivity();
      var shared = require_shared();
      function pushWarningContext(vnode) {
      }
      function popWarningContext() {
      }
      function assertNumber(val, type) {
        return;
      }
      var ErrorCodes = {
        "SETUP_FUNCTION": 0,
        "0": "SETUP_FUNCTION",
        "RENDER_FUNCTION": 1,
        "1": "RENDER_FUNCTION",
        "NATIVE_EVENT_HANDLER": 5,
        "5": "NATIVE_EVENT_HANDLER",
        "COMPONENT_EVENT_HANDLER": 6,
        "6": "COMPONENT_EVENT_HANDLER",
        "VNODE_HOOK": 7,
        "7": "VNODE_HOOK",
        "DIRECTIVE_HOOK": 8,
        "8": "DIRECTIVE_HOOK",
        "TRANSITION_HOOK": 9,
        "9": "TRANSITION_HOOK",
        "APP_ERROR_HANDLER": 10,
        "10": "APP_ERROR_HANDLER",
        "APP_WARN_HANDLER": 11,
        "11": "APP_WARN_HANDLER",
        "FUNCTION_REF": 12,
        "12": "FUNCTION_REF",
        "ASYNC_COMPONENT_LOADER": 13,
        "13": "ASYNC_COMPONENT_LOADER",
        "SCHEDULER": 14,
        "14": "SCHEDULER",
        "COMPONENT_UPDATE": 15,
        "15": "COMPONENT_UPDATE",
        "APP_UNMOUNT_CLEANUP": 16,
        "16": "APP_UNMOUNT_CLEANUP"
      };
      var ErrorTypeStrings$1 = {
        ["sp"]: "serverPrefetch hook",
        ["bc"]: "beforeCreate hook",
        ["c"]: "created hook",
        ["bm"]: "beforeMount hook",
        ["m"]: "mounted hook",
        ["bu"]: "beforeUpdate hook",
        ["u"]: "updated",
        ["bum"]: "beforeUnmount hook",
        ["um"]: "unmounted hook",
        ["a"]: "activated hook",
        ["da"]: "deactivated hook",
        ["ec"]: "errorCaptured hook",
        ["rtc"]: "renderTracked hook",
        ["rtg"]: "renderTriggered hook",
        [0]: "setup function",
        [1]: "render function",
        [2]: "watcher getter",
        [3]: "watcher callback",
        [4]: "watcher cleanup function",
        [5]: "native event handler",
        [6]: "component event handler",
        [7]: "vnode hook",
        [8]: "directive hook",
        [9]: "transition hook",
        [10]: "app errorHandler",
        [11]: "app warnHandler",
        [12]: "ref function",
        [13]: "async component loader",
        [14]: "scheduler flush",
        [15]: "component update",
        [16]: "app unmount cleanup function"
      };
      function callWithErrorHandling(fn, instance, type, args) {
        try {
          return args ? fn(...args) : fn();
        } catch (err) {
          handleError(err, instance, type);
        }
      }
      function callWithAsyncErrorHandling(fn, instance, type, args) {
        if (shared.isFunction(fn)) {
          const res = callWithErrorHandling(fn, instance, type, args);
          if (res && shared.isPromise(res)) {
            res.catch((err) => {
              handleError(err, instance, type);
            });
          }
          return res;
        }
        if (shared.isArray(fn)) {
          const values = [];
          for (let i = 0; i < fn.length; i++) {
            values.push(callWithAsyncErrorHandling(fn[i], instance, type, args));
          }
          return values;
        }
      }
      function handleError(err, instance, type, throwInDev = true) {
        const contextVNode = instance ? instance.vnode : null;
        const { errorHandler, throwUnhandledErrorInProduction } = instance && instance.appContext.config || shared.EMPTY_OBJ;
        if (instance) {
          let cur = instance.parent;
          const exposedInstance = instance.proxy;
          const errorInfo = `https://vuejs.org/error-reference/#runtime-${type}`;
          while (cur) {
            const errorCapturedHooks = cur.ec;
            if (errorCapturedHooks) {
              for (let i = 0; i < errorCapturedHooks.length; i++) {
                if (errorCapturedHooks[i](err, exposedInstance, errorInfo) === false) {
                  return;
                }
              }
            }
            cur = cur.parent;
          }
          if (errorHandler) {
            reactivity.pauseTracking();
            callWithErrorHandling(errorHandler, null, 10, [
              err,
              exposedInstance,
              errorInfo
            ]);
            reactivity.resetTracking();
            return;
          }
        }
        logError(err, type, contextVNode, throwInDev, throwUnhandledErrorInProduction);
      }
      function logError(err, type, contextVNode, throwInDev = true, throwInProd = false) {
        if (throwInProd) {
          throw err;
        } else {
          console.error(err);
        }
      }
      var queue = [];
      var flushIndex = -1;
      var pendingPostFlushCbs = [];
      var activePostFlushCbs = null;
      var postFlushIndex = 0;
      var resolvedPromise = /* @__PURE__ */ Promise.resolve();
      var currentFlushPromise = null;
      function nextTick(fn) {
        const p = currentFlushPromise || resolvedPromise;
        return fn ? p.then(this ? fn.bind(this) : fn) : p;
      }
      function findInsertionIndex(id) {
        let start = flushIndex + 1;
        let end = queue.length;
        while (start < end) {
          const middle = start + end >>> 1;
          const middleJob = queue[middle];
          const middleJobId = getId(middleJob);
          if (middleJobId < id || middleJobId === id && middleJob.flags & 2) {
            start = middle + 1;
          } else {
            end = middle;
          }
        }
        return start;
      }
      function queueJob(job) {
        if (!(job.flags & 1)) {
          const jobId = getId(job);
          const lastJob = queue[queue.length - 1];
          if (!lastJob || // fast path when the job id is larger than the tail
          !(job.flags & 2) && jobId >= getId(lastJob)) {
            queue.push(job);
          } else {
            queue.splice(findInsertionIndex(jobId), 0, job);
          }
          job.flags |= 1;
          queueFlush();
        }
      }
      function queueFlush() {
        if (!currentFlushPromise) {
          currentFlushPromise = resolvedPromise.then(flushJobs);
        }
      }
      function queuePostFlushCb(cb) {
        if (!shared.isArray(cb)) {
          if (activePostFlushCbs && cb.id === -1) {
            activePostFlushCbs.splice(postFlushIndex + 1, 0, cb);
          } else if (!(cb.flags & 1)) {
            pendingPostFlushCbs.push(cb);
            cb.flags |= 1;
          }
        } else {
          for (let i = 0; i < cb.length; i++) {
            pendingPostFlushCbs.push(cb[i]);
          }
        }
        queueFlush();
      }
      function flushPreFlushCbs(instance, seen, i = flushIndex + 1) {
        for (; i < queue.length; i++) {
          const cb = queue[i];
          if (cb && cb.flags & 2) {
            if (instance && cb.id !== instance.uid) {
              continue;
            }
            queue.splice(i, 1);
            i--;
            if (cb.flags & 4) {
              cb.flags &= -2;
            }
            cb();
            if (!(cb.flags & 4)) {
              cb.flags &= -2;
            }
          }
        }
      }
      function flushPostFlushCbs(seen) {
        if (pendingPostFlushCbs.length) {
          const deduped = [...new Set(pendingPostFlushCbs)].sort(
            (a, b) => getId(a) - getId(b)
          );
          pendingPostFlushCbs.length = 0;
          if (activePostFlushCbs) {
            for (let i = 0; i < deduped.length; i++) {
              activePostFlushCbs.push(deduped[i]);
            }
            return;
          }
          activePostFlushCbs = deduped;
          for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
            const cb = activePostFlushCbs[postFlushIndex];
            if (cb.flags & 4) {
              cb.flags &= -2;
            }
            if (!(cb.flags & 8)) cb();
            cb.flags &= -2;
          }
          activePostFlushCbs = null;
          postFlushIndex = 0;
        }
      }
      var getId = (job) => job.id == null ? job.flags & 2 ? -1 : Infinity : job.id;
      function flushJobs(seen) {
        try {
          for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
            const job = queue[flushIndex];
            if (job && !(job.flags & 8)) {
              if (false) ;
              if (job.flags & 4) {
                job.flags &= ~1;
              }
              callWithErrorHandling(
                job,
                job.i,
                job.i ? 15 : 14
              );
              if (!(job.flags & 4)) {
                job.flags &= ~1;
              }
            }
          }
        } finally {
          for (; flushIndex < queue.length; flushIndex++) {
            const job = queue[flushIndex];
            if (job) {
              job.flags &= -2;
            }
          }
          flushIndex = -1;
          queue.length = 0;
          flushPostFlushCbs();
          currentFlushPromise = null;
          if (queue.length || pendingPostFlushCbs.length) {
            flushJobs();
          }
        }
      }
      var currentRenderingInstance = null;
      var currentScopeId = null;
      function setCurrentRenderingInstance(instance) {
        const prev = currentRenderingInstance;
        currentRenderingInstance = instance;
        currentScopeId = instance && instance.type.__scopeId || null;
        return prev;
      }
      function pushScopeId(id) {
        currentScopeId = id;
      }
      function popScopeId() {
        currentScopeId = null;
      }
      var withScopeId = (_id) => withCtx;
      function withCtx(fn, ctx = currentRenderingInstance, isNonScopedSlot) {
        if (!ctx) return fn;
        if (fn._n) {
          return fn;
        }
        const renderFnWithContext = (...args) => {
          if (renderFnWithContext._d) {
            setBlockTracking(-1);
          }
          const prevInstance = setCurrentRenderingInstance(ctx);
          const prevStackSize = blockStack.length;
          let res;
          try {
            res = fn(...args);
          } finally {
            for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
            setCurrentRenderingInstance(prevInstance);
            if (renderFnWithContext._d) {
              setBlockTracking(1);
            }
          }
          return res;
        };
        renderFnWithContext._n = true;
        renderFnWithContext._c = true;
        renderFnWithContext._d = true;
        return renderFnWithContext;
      }
      function withDirectives(vnode, directives) {
        if (currentRenderingInstance === null) {
          return vnode;
        }
        const instance = getComponentPublicInstance(currentRenderingInstance);
        const bindings = vnode.dirs || (vnode.dirs = []);
        for (let i = 0; i < directives.length; i++) {
          let [dir, value, arg, modifiers = shared.EMPTY_OBJ] = directives[i];
          if (dir) {
            if (shared.isFunction(dir)) {
              dir = {
                mounted: dir,
                updated: dir
              };
            }
            if (dir.deep) {
              reactivity.traverse(value);
            }
            bindings.push({
              dir,
              instance,
              value,
              oldValue: void 0,
              arg,
              modifiers
            });
          }
        }
        return vnode;
      }
      function invokeDirectiveHook(vnode, prevVNode, instance, name) {
        const bindings = vnode.dirs;
        const oldBindings = prevVNode && prevVNode.dirs;
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          if (oldBindings) {
            binding.oldValue = oldBindings[i].value;
          }
          let hook = binding.dir[name];
          if (hook) {
            reactivity.pauseTracking();
            callWithAsyncErrorHandling(hook, instance, 8, [
              vnode.el,
              binding,
              vnode,
              prevVNode
            ]);
            reactivity.resetTracking();
          }
        }
      }
      function provide(key, value) {
        if (currentInstance) {
          let provides = currentInstance.provides;
          const parentProvides = currentInstance.parent && currentInstance.parent.provides;
          if (parentProvides === provides) {
            provides = currentInstance.provides = Object.create(parentProvides);
          }
          provides[key] = value;
        }
      }
      function inject(key, defaultValue, treatDefaultAsFactory = false) {
        const instance = getCurrentInstance2();
        if (instance || currentApp) {
          let provides = currentApp ? currentApp._context.provides : instance ? instance.parent == null || instance.ce ? instance.vnode.appContext && instance.vnode.appContext.provides : instance.parent.provides : void 0;
          if (provides && key in provides) {
            return provides[key];
          } else if (arguments.length > 1) {
            return treatDefaultAsFactory && shared.isFunction(defaultValue) ? defaultValue.call(instance && instance.proxy) : defaultValue;
          } else ;
        }
      }
      function hasInjectionContext() {
        return !!(getCurrentInstance2() || currentApp);
      }
      var ssrContextKey = /* @__PURE__ */ Symbol.for("v-scx");
      var useSSRContext = () => {
        {
          const ctx = inject(ssrContextKey);
          return ctx;
        }
      };
      function watchEffect(effect, options) {
        return doWatch(effect, null, options);
      }
      function watchPostEffect(effect, options) {
        return doWatch(
          effect,
          null,
          { flush: "post" }
        );
      }
      function watchSyncEffect(effect, options) {
        return doWatch(
          effect,
          null,
          { flush: "sync" }
        );
      }
      function watch(source, cb, options) {
        return doWatch(source, cb, options);
      }
      function doWatch(source, cb, options = shared.EMPTY_OBJ) {
        const { immediate, deep, flush, once } = options;
        const baseWatchOptions = shared.extend({}, options);
        const runsImmediately = cb && immediate || !cb && flush !== "post";
        let ssrCleanup;
        if (isInSSRComponentSetup) {
          if (flush === "sync") {
            const ctx = useSSRContext();
            ssrCleanup = ctx.__watcherHandles || (ctx.__watcherHandles = []);
          } else if (!runsImmediately) {
            const watchStopHandle = () => {
            };
            watchStopHandle.stop = shared.NOOP;
            watchStopHandle.resume = shared.NOOP;
            watchStopHandle.pause = shared.NOOP;
            return watchStopHandle;
          }
        }
        const instance = currentInstance;
        baseWatchOptions.call = (fn, type, args) => callWithAsyncErrorHandling(fn, instance, type, args);
        let isPre = false;
        if (flush === "post") {
          baseWatchOptions.scheduler = (job) => {
            queuePostRenderEffect(job, instance && instance.suspense);
          };
        } else if (flush !== "sync") {
          isPre = true;
          baseWatchOptions.scheduler = (job, isFirstRun) => {
            if (isFirstRun) {
              job();
            } else {
              queueJob(job);
            }
          };
        }
        baseWatchOptions.augmentJob = (job) => {
          if (cb) {
            job.flags |= 4;
          }
          if (isPre) {
            job.flags |= 2;
            if (instance) {
              job.id = instance.uid;
              job.i = instance;
            }
          }
        };
        const watchHandle = reactivity.watch(source, cb, baseWatchOptions);
        if (isInSSRComponentSetup) {
          if (ssrCleanup) {
            ssrCleanup.push(watchHandle);
          } else if (runsImmediately) {
            watchHandle();
          }
        }
        return watchHandle;
      }
      function instanceWatch(source, value, options) {
        const publicThis = this.proxy;
        const getter = shared.isString(source) ? source.includes(".") ? createPathGetter(publicThis, source) : () => publicThis[source] : source.bind(publicThis, publicThis);
        let cb;
        if (shared.isFunction(value)) {
          cb = value;
        } else {
          cb = value.handler;
          options = value;
        }
        const reset = setCurrentInstance(this);
        const res = doWatch(getter, cb.bind(publicThis), options);
        reset();
        return res;
      }
      function createPathGetter(ctx, path) {
        const segments = path.split(".");
        return () => {
          let cur = ctx;
          for (let i = 0; i < segments.length && cur; i++) {
            cur = cur[segments[i]];
          }
          return cur;
        };
      }
      var pendingMounts = /* @__PURE__ */ new WeakMap();
      var TeleportEndKey = /* @__PURE__ */ Symbol("_vte");
      var isTeleport = (type) => type.__isTeleport;
      var isTeleportDisabled = (props) => props && (props.disabled || props.disabled === "");
      var isTeleportDeferred = (props) => props && (props.defer || props.defer === "");
      var isTargetSVG = (target) => typeof SVGElement !== "undefined" && target instanceof SVGElement;
      var isTargetMathML = (target) => typeof MathMLElement === "function" && target instanceof MathMLElement;
      var resolveTarget = (props, select) => {
        const targetSelector = props && props.to;
        if (shared.isString(targetSelector)) {
          if (!select) {
            return null;
          } else {
            const target = select(targetSelector);
            return target;
          }
        } else {
          return targetSelector;
        }
      };
      var TeleportImpl = {
        name: "Teleport",
        __isTeleport: true,
        process(n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, internals) {
          const {
            mc: mountChildren,
            pc: patchChildren,
            pbc: patchBlockChildren,
            o: { insert, querySelector, createText, createComment, parentNode }
          } = internals;
          const disabled = isTeleportDisabled(n2.props);
          let { dynamicChildren } = n2;
          const mount = (vnode, container2, anchor2) => {
            if (vnode.shapeFlag & 16) {
              mountChildren(
                vnode.children,
                container2,
                anchor2,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            }
          };
          const mountToTarget = (vnode = n2) => {
            const disabled2 = isTeleportDisabled(vnode.props);
            const target = vnode.target = resolveTarget(vnode.props, querySelector);
            const targetAnchor = prepareAnchor(target, vnode, createText, insert);
            if (target) {
              if (namespace !== "svg" && isTargetSVG(target)) {
                namespace = "svg";
              } else if (namespace !== "mathml" && isTargetMathML(target)) {
                namespace = "mathml";
              }
              if (parentComponent && parentComponent.isCE) {
                (parentComponent.ce._teleportTargets || (parentComponent.ce._teleportTargets = /* @__PURE__ */ new Set())).add(target);
              }
              if (!disabled2) {
                mount(vnode, target, targetAnchor);
                updateCssVars(vnode, false);
              }
            }
          };
          const queuePendingMount = (vnode) => {
            const mountJob = () => {
              if (pendingMounts.get(vnode) !== mountJob) return;
              pendingMounts.delete(vnode);
              if (isTeleportDisabled(vnode.props)) {
                const mountContainer = parentNode(vnode.el) || container;
                mount(vnode, mountContainer, vnode.anchor);
                updateCssVars(vnode, true);
              }
              mountToTarget(vnode);
            };
            pendingMounts.set(vnode, mountJob);
            queuePostRenderEffect(mountJob, parentSuspense);
          };
          if (n1 == null) {
            const placeholder = n2.el = createText("");
            const mainAnchor = n2.anchor = createText("");
            insert(placeholder, container, anchor);
            insert(mainAnchor, container, anchor);
            if (isTeleportDeferred(n2.props) || parentSuspense && parentSuspense.pendingBranch) {
              queuePendingMount(n2);
              return;
            }
            if (disabled) {
              mount(n2, container, mainAnchor);
              updateCssVars(n2, true);
            }
            mountToTarget();
          } else {
            n2.el = n1.el;
            const mainAnchor = n2.anchor = n1.anchor;
            const pendingMount = pendingMounts.get(n1);
            if (pendingMount) {
              pendingMount.flags |= 8;
              pendingMounts.delete(n1);
              queuePendingMount(n2);
              return;
            }
            n2.targetStart = n1.targetStart;
            const target = n2.target = n1.target;
            const targetAnchor = n2.targetAnchor = n1.targetAnchor;
            const wasDisabled = isTeleportDisabled(n1.props);
            const currentContainer = wasDisabled ? container : target;
            const currentAnchor = wasDisabled ? mainAnchor : targetAnchor;
            if (namespace === "svg" || isTargetSVG(target)) {
              namespace = "svg";
            } else if (namespace === "mathml" || isTargetMathML(target)) {
              namespace = "mathml";
            }
            if (dynamicChildren) {
              patchBlockChildren(
                n1.dynamicChildren,
                dynamicChildren,
                currentContainer,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds
              );
              traverseStaticChildren(n1, n2, true);
            } else if (!optimized) {
              patchChildren(
                n1,
                n2,
                currentContainer,
                currentAnchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                false
              );
            }
            if (disabled) {
              if (!wasDisabled) {
                moveTeleport(
                  n2,
                  container,
                  mainAnchor,
                  internals,
                  1
                );
              } else {
                if (n2.props && n1.props && n2.props.to !== n1.props.to) {
                  n2.props.to = n1.props.to;
                }
              }
            } else {
              if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
                const nextTarget = resolveTarget(n2.props, querySelector);
                if (nextTarget) {
                  n2.target = nextTarget;
                  moveTeleport(
                    n2,
                    nextTarget,
                    null,
                    internals,
                    0
                  );
                }
              } else if (wasDisabled) {
                moveTeleport(
                  n2,
                  target,
                  targetAnchor,
                  internals,
                  1
                );
              }
            }
            updateCssVars(n2, disabled);
          }
        },
        remove(vnode, parentComponent, parentSuspense, { um: unmount, o: { remove: hostRemove } }, doRemove) {
          const {
            shapeFlag,
            children,
            anchor,
            targetStart,
            targetAnchor,
            target,
            props
          } = vnode;
          const disabled = isTeleportDisabled(props);
          const shouldRemove = doRemove || !disabled;
          const pendingMount = pendingMounts.get(vnode);
          if (pendingMount) {
            pendingMount.flags |= 8;
            pendingMounts.delete(vnode);
          }
          if (target) {
            hostRemove(targetStart);
            hostRemove(targetAnchor);
          }
          doRemove && hostRemove(anchor);
          if (!pendingMount && (disabled || target) && shapeFlag & 16) {
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              unmount(
                child,
                parentComponent,
                parentSuspense,
                shouldRemove,
                !!child.dynamicChildren
              );
            }
          }
        },
        move: moveTeleport,
        hydrate: hydrateTeleport
      };
      function moveTeleport(vnode, container, parentAnchor, { o: { insert }, m: move }, moveType = 2) {
        if (moveType === 0) {
          insert(vnode.targetAnchor, container, parentAnchor);
        }
        const { el, anchor, shapeFlag, children, props } = vnode;
        const isReorder = moveType === 2;
        if (isReorder) {
          insert(el, container, parentAnchor);
        }
        if (!pendingMounts.has(vnode) && (!isReorder || isTeleportDisabled(props))) {
          if (shapeFlag & 16) {
            for (let i = 0; i < children.length; i++) {
              move(
                children[i],
                container,
                parentAnchor,
                2
              );
            }
          }
        }
        if (isReorder) {
          insert(anchor, container, parentAnchor);
        }
      }
      function hydrateTeleport(node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized, {
        o: { nextSibling, parentNode, querySelector, insert, createText }
      }, hydrateChildren) {
        function hydrateAnchor(target2, targetNode) {
          let targetAnchor = targetNode;
          while (targetAnchor) {
            if (targetAnchor && targetAnchor.nodeType === 8) {
              if (targetAnchor.data === "teleport start anchor") {
                vnode.targetStart = targetAnchor;
              } else if (targetAnchor.data === "teleport anchor") {
                vnode.targetAnchor = targetAnchor;
                target2._lpa = vnode.targetAnchor && nextSibling(vnode.targetAnchor);
                break;
              }
            }
            targetAnchor = nextSibling(targetAnchor);
          }
        }
        function hydrateDisabledTeleport(node2, vnode2) {
          vnode2.anchor = hydrateChildren(
            nextSibling(node2),
            vnode2,
            parentNode(node2),
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          );
        }
        const target = vnode.target = resolveTarget(
          vnode.props,
          querySelector
        );
        const disabled = isTeleportDisabled(vnode.props);
        if (target) {
          const targetNode = target._lpa || target.firstChild;
          if (vnode.shapeFlag & 16) {
            if (disabled) {
              hydrateDisabledTeleport(node, vnode);
              hydrateAnchor(target, targetNode);
              if (!vnode.targetAnchor) {
                prepareAnchor(
                  target,
                  vnode,
                  createText,
                  insert,
                  // if target is the same as the main view, insert anchors before current node
                  // to avoid hydrating mismatch
                  parentNode(node) === target ? node : null
                );
              }
            } else {
              vnode.anchor = nextSibling(node);
              hydrateAnchor(target, targetNode);
              if (!vnode.targetAnchor) {
                prepareAnchor(target, vnode, createText, insert);
              }
              hydrateChildren(
                targetNode && nextSibling(targetNode),
                vnode,
                target,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
            }
          }
          updateCssVars(vnode, disabled);
        } else if (disabled) {
          if (vnode.shapeFlag & 16) {
            hydrateDisabledTeleport(node, vnode);
            vnode.targetStart = node;
            vnode.targetAnchor = nextSibling(node);
          }
        }
        return vnode.anchor && nextSibling(vnode.anchor);
      }
      var Teleport = TeleportImpl;
      function updateCssVars(vnode, isDisabled) {
        const ctx = vnode.ctx;
        if (ctx && ctx.ut) {
          let node, anchor;
          if (isDisabled) {
            node = vnode.el;
            anchor = vnode.anchor;
          } else {
            node = vnode.targetStart;
            anchor = vnode.targetAnchor;
          }
          while (node && node !== anchor) {
            if (node.nodeType === 1) node.setAttribute("data-v-owner", ctx.uid);
            node = node.nextSibling;
          }
          ctx.ut();
        }
      }
      function prepareAnchor(target, vnode, createText, insert, anchor = null) {
        const targetStart = vnode.targetStart = createText("");
        const targetAnchor = vnode.targetAnchor = createText("");
        targetStart[TeleportEndKey] = targetAnchor;
        if (target) {
          insert(targetStart, target, anchor);
          insert(targetAnchor, target, anchor);
        }
        return targetAnchor;
      }
      var leaveCbKey = /* @__PURE__ */ Symbol("_leaveCb");
      var enterCbKey = /* @__PURE__ */ Symbol("_enterCb");
      function useTransitionState() {
        const state = {
          isMounted: false,
          isLeaving: false,
          isUnmounting: false,
          leavingVNodes: /* @__PURE__ */ new Map()
        };
        onMounted(() => {
          state.isMounted = true;
        });
        onBeforeUnmount(() => {
          state.isUnmounting = true;
        });
        return state;
      }
      var TransitionHookValidator = [Function, Array];
      var BaseTransitionPropsValidators = {
        mode: String,
        appear: Boolean,
        persisted: Boolean,
        // enter
        onBeforeEnter: TransitionHookValidator,
        onEnter: TransitionHookValidator,
        onAfterEnter: TransitionHookValidator,
        onEnterCancelled: TransitionHookValidator,
        // leave
        onBeforeLeave: TransitionHookValidator,
        onLeave: TransitionHookValidator,
        onAfterLeave: TransitionHookValidator,
        onLeaveCancelled: TransitionHookValidator,
        // appear
        onBeforeAppear: TransitionHookValidator,
        onAppear: TransitionHookValidator,
        onAfterAppear: TransitionHookValidator,
        onAppearCancelled: TransitionHookValidator
      };
      var recursiveGetSubtree = (instance) => {
        const subTree = instance.subTree;
        return subTree.component ? recursiveGetSubtree(subTree.component) : subTree;
      };
      var BaseTransitionImpl = {
        name: `BaseTransition`,
        props: BaseTransitionPropsValidators,
        setup(props, { slots }) {
          const instance = getCurrentInstance2();
          const state = useTransitionState();
          return () => {
            const children = slots.default && getTransitionRawChildren(slots.default(), true);
            const child = children && children.length ? findNonCommentChild(children) : (
              // Keep explicit default-slot conditionals on the same transition path
              // as regular v-if branches, which render a comment placeholder.
              instance.subTree ? createCommentVNode() : void 0
            );
            if (!child) {
              return;
            }
            const rawProps = reactivity.toRaw(props);
            const { mode } = rawProps;
            if (state.isLeaving) {
              return emptyPlaceholder(child);
            }
            const innerChild = getInnerChild$1(child);
            if (!innerChild) {
              return emptyPlaceholder(child);
            }
            let enterHooks = resolveTransitionHooks(
              innerChild,
              rawProps,
              state,
              instance,
              // #11061, ensure enterHooks is fresh after clone
              (hooks) => enterHooks = hooks
            );
            if (innerChild.type !== Comment) {
              setTransitionHooks(innerChild, enterHooks);
            }
            let oldInnerChild = instance.subTree && getInnerChild$1(instance.subTree);
            if (oldInnerChild && oldInnerChild.type !== Comment && !isSameVNodeType(oldInnerChild, innerChild) && recursiveGetSubtree(instance).type !== Comment) {
              let leavingHooks = resolveTransitionHooks(
                oldInnerChild,
                rawProps,
                state,
                instance
              );
              setTransitionHooks(oldInnerChild, leavingHooks);
              if (mode === "out-in" && innerChild.type !== Comment) {
                state.isLeaving = true;
                leavingHooks.afterLeave = () => {
                  state.isLeaving = false;
                  if (!(instance.job.flags & 8)) {
                    instance.update();
                  }
                  delete leavingHooks.afterLeave;
                  oldInnerChild = void 0;
                };
                return emptyPlaceholder(child);
              } else if (mode === "in-out" && innerChild.type !== Comment) {
                leavingHooks.delayLeave = (el, earlyRemove, delayedLeave) => {
                  const leavingVNodesCache = getLeavingNodesForType(
                    state,
                    oldInnerChild
                  );
                  leavingVNodesCache[String(oldInnerChild.key)] = oldInnerChild;
                  el[leaveCbKey] = () => {
                    earlyRemove();
                    el[leaveCbKey] = void 0;
                    delete enterHooks.delayedLeave;
                    oldInnerChild = void 0;
                  };
                  enterHooks.delayedLeave = () => {
                    delayedLeave();
                    delete enterHooks.delayedLeave;
                    oldInnerChild = void 0;
                  };
                };
              } else {
                oldInnerChild = void 0;
              }
            } else if (oldInnerChild) {
              oldInnerChild = void 0;
            }
            return child;
          };
        }
      };
      function findNonCommentChild(children) {
        let child = children[0];
        if (children.length > 1) {
          for (const c of children) {
            if (c.type !== Comment) {
              child = c;
              break;
            }
          }
        }
        return child;
      }
      var BaseTransition = BaseTransitionImpl;
      function getLeavingNodesForType(state, vnode) {
        const { leavingVNodes } = state;
        let leavingVNodesCache = leavingVNodes.get(vnode.type);
        if (!leavingVNodesCache) {
          leavingVNodesCache = /* @__PURE__ */ Object.create(null);
          leavingVNodes.set(vnode.type, leavingVNodesCache);
        }
        return leavingVNodesCache;
      }
      function resolveTransitionHooks(vnode, props, state, instance, postClone) {
        const {
          appear,
          mode,
          persisted = false,
          onBeforeEnter,
          onEnter,
          onAfterEnter,
          onEnterCancelled,
          onBeforeLeave,
          onLeave,
          onAfterLeave,
          onLeaveCancelled,
          onBeforeAppear,
          onAppear,
          onAfterAppear,
          onAppearCancelled
        } = props;
        const key = String(vnode.key);
        const leavingVNodesCache = getLeavingNodesForType(state, vnode);
        const callHook2 = (hook, args) => {
          hook && callWithAsyncErrorHandling(
            hook,
            instance,
            9,
            args
          );
        };
        const callAsyncHook = (hook, args) => {
          const done = args[1];
          callHook2(hook, args);
          if (shared.isArray(hook)) {
            if (hook.every((hook2) => hook2.length <= 1)) done();
          } else if (hook.length <= 1) {
            done();
          }
        };
        const hooks = {
          mode,
          persisted,
          beforeEnter(el) {
            let hook = onBeforeEnter;
            if (!state.isMounted) {
              if (appear) {
                hook = onBeforeAppear || onBeforeEnter;
              } else {
                return;
              }
            }
            if (el[leaveCbKey]) {
              el[leaveCbKey](
                true
                /* cancelled */
              );
            }
            const leavingVNode = leavingVNodesCache[key];
            if (leavingVNode && isSameVNodeType(vnode, leavingVNode) && leavingVNode.el[leaveCbKey]) {
              leavingVNode.el[leaveCbKey]();
            }
            callHook2(hook, [el]);
          },
          enter(el) {
            if (leavingVNodesCache[key] === vnode) return;
            let hook = onEnter;
            let afterHook = onAfterEnter;
            let cancelHook = onEnterCancelled;
            if (!state.isMounted) {
              if (appear) {
                hook = onAppear || onEnter;
                afterHook = onAfterAppear || onAfterEnter;
                cancelHook = onAppearCancelled || onEnterCancelled;
              } else {
                return;
              }
            }
            let called = false;
            el[enterCbKey] = (cancelled) => {
              if (called) return;
              called = true;
              if (cancelled) {
                callHook2(cancelHook, [el]);
              } else {
                callHook2(afterHook, [el]);
              }
              if (hooks.delayedLeave) {
                hooks.delayedLeave();
              }
              el[enterCbKey] = void 0;
            };
            const done = el[enterCbKey].bind(null, false);
            if (hook) {
              callAsyncHook(hook, [el, done]);
            } else {
              done();
            }
          },
          leave(el, remove) {
            const key2 = String(vnode.key);
            if (el[enterCbKey]) {
              el[enterCbKey](
                true
                /* cancelled */
              );
            }
            if (state.isUnmounting) {
              return remove();
            }
            callHook2(onBeforeLeave, [el]);
            let called = false;
            el[leaveCbKey] = (cancelled) => {
              if (called) return;
              called = true;
              remove();
              if (cancelled) {
                callHook2(onLeaveCancelled, [el]);
              } else {
                callHook2(onAfterLeave, [el]);
              }
              el[leaveCbKey] = void 0;
              if (leavingVNodesCache[key2] === vnode) {
                delete leavingVNodesCache[key2];
              }
            };
            const done = el[leaveCbKey].bind(null, false);
            leavingVNodesCache[key2] = vnode;
            if (onLeave) {
              callAsyncHook(onLeave, [el, done]);
            } else {
              done();
            }
          },
          clone(vnode2) {
            const hooks2 = resolveTransitionHooks(
              vnode2,
              props,
              state,
              instance,
              postClone
            );
            if (postClone) postClone(hooks2);
            return hooks2;
          }
        };
        return hooks;
      }
      function emptyPlaceholder(vnode) {
        if (isKeepAlive(vnode)) {
          vnode = cloneVNode(vnode);
          vnode.children = null;
          return vnode;
        }
      }
      function getInnerChild$1(vnode) {
        if (!isKeepAlive(vnode)) {
          if (isTeleport(vnode.type) && vnode.children) {
            return findNonCommentChild(vnode.children);
          }
          return vnode;
        }
        if (vnode.component) {
          return vnode.component.subTree;
        }
        const { shapeFlag, children } = vnode;
        if (children) {
          if (shapeFlag & 16) {
            return children[0];
          }
          if (shapeFlag & 32 && shared.isFunction(children.default)) {
            return children.default();
          }
        }
      }
      function setTransitionHooks(vnode, hooks) {
        if (vnode.shapeFlag & 6 && vnode.component) {
          vnode.transition = hooks;
          const subTree = vnode.component.subTree;
          setTransitionHooks(
            isTeleport(subTree.type) ? getInnerChild$1(subTree) || subTree : subTree,
            hooks
          );
        } else if (vnode.shapeFlag & 128) {
          vnode.ssContent.transition = hooks.clone(vnode.ssContent);
          vnode.ssFallback.transition = hooks.clone(vnode.ssFallback);
        } else {
          vnode.transition = hooks;
        }
      }
      function getTransitionRawChildren(children, keepComment = false, parentKey) {
        let ret = [];
        let keyedFragmentCount = 0;
        for (let i = 0; i < children.length; i++) {
          let child = children[i];
          const key = parentKey == null ? child.key : String(parentKey) + String(child.key != null ? child.key : i);
          if (child.type === Fragment) {
            if (child.patchFlag & 128) keyedFragmentCount++;
            ret = ret.concat(
              getTransitionRawChildren(child.children, keepComment, key)
            );
          } else if (keepComment || child.type !== Comment) {
            ret.push(key != null ? cloneVNode(child, { key }) : child);
          }
        }
        if (keyedFragmentCount > 1) {
          for (let i = 0; i < ret.length; i++) {
            ret[i].patchFlag = -2;
          }
        }
        return ret;
      }
      // @__NO_SIDE_EFFECTS__
      function defineComponent(options, extraOptions) {
        return shared.isFunction(options) ? (
          // #8236: extend call and options.name access are considered side-effects
          // by Rollup, so we have to wrap it in a pure-annotated IIFE.
          /* @__PURE__ */ (() => shared.extend({ name: options.name }, extraOptions, { setup: options }))()
        ) : options;
      }
      function useId() {
        const i = getCurrentInstance2();
        if (i) {
          return (i.appContext.config.idPrefix || "v") + "-" + i.ids[0] + i.ids[1]++;
        }
        return "";
      }
      function markAsyncBoundary(instance) {
        instance.ids = [instance.ids[0] + instance.ids[2]++ + "-", 0, 0];
      }
      function useTemplateRef(key) {
        const i = getCurrentInstance2();
        const r = reactivity.shallowRef(null);
        if (i) {
          const refs = i.refs === shared.EMPTY_OBJ ? i.refs = {} : i.refs;
          {
            Object.defineProperty(refs, key, {
              enumerable: true,
              get: () => r.value,
              set: (val) => r.value = val
            });
          }
        }
        const ret = r;
        return ret;
      }
      function isTemplateRefKey(refs, key) {
        let desc;
        return !!((desc = Object.getOwnPropertyDescriptor(refs, key)) && !desc.configurable);
      }
      var pendingSetRefMap = /* @__PURE__ */ new WeakMap();
      function setRef(rawRef, oldRawRef, parentSuspense, vnode, isUnmount = false) {
        if (shared.isArray(rawRef)) {
          rawRef.forEach(
            (r, i) => setRef(
              r,
              oldRawRef && (shared.isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
              parentSuspense,
              vnode,
              isUnmount
            )
          );
          return;
        }
        if (isAsyncWrapper(vnode) && !isUnmount) {
          if (vnode.shapeFlag & 512 && vnode.type.__asyncResolved && vnode.component.subTree.component) {
            setRef(rawRef, oldRawRef, parentSuspense, vnode.component.subTree);
          }
          return;
        }
        const refValue = vnode.shapeFlag & 4 ? getComponentPublicInstance(vnode.component) : vnode.el;
        const value = isUnmount ? null : refValue;
        const { i: owner, r: ref2 } = rawRef;
        const oldRef = oldRawRef && oldRawRef.r;
        const refs = owner.refs === shared.EMPTY_OBJ ? owner.refs = {} : owner.refs;
        const setupState = owner.setupState;
        const rawSetupState = reactivity.toRaw(setupState);
        const canSetSetupRef = setupState === shared.EMPTY_OBJ ? shared.NO : (key) => {
          if (isTemplateRefKey(refs, key)) {
            return false;
          }
          return shared.hasOwn(rawSetupState, key);
        };
        const canSetRef = (ref22, key) => {
          if (key && isTemplateRefKey(refs, key)) {
            return false;
          }
          return true;
        };
        if (oldRef != null && oldRef !== ref2) {
          invalidatePendingSetRef(oldRawRef);
          if (shared.isString(oldRef)) {
            refs[oldRef] = null;
            if (canSetSetupRef(oldRef)) {
              setupState[oldRef] = null;
            }
          } else if (reactivity.isRef(oldRef)) {
            const oldRawRefAtom = oldRawRef;
            if (canSetRef(oldRef, oldRawRefAtom.k)) {
              oldRef.value = null;
            }
            if (oldRawRefAtom.k) refs[oldRawRefAtom.k] = null;
          }
        }
        if (shared.isFunction(ref2)) {
          callWithErrorHandling(ref2, owner, 12, [value, refs]);
        } else {
          const _isString = shared.isString(ref2);
          const _isRef = reactivity.isRef(ref2);
          if (_isString || _isRef) {
            const doSet = () => {
              if (rawRef.f) {
                const existing = _isString ? canSetSetupRef(ref2) ? setupState[ref2] : refs[ref2] : canSetRef() || !rawRef.k ? ref2.value : refs[rawRef.k];
                if (isUnmount) {
                  shared.isArray(existing) && shared.remove(existing, refValue);
                } else {
                  if (!shared.isArray(existing)) {
                    if (_isString) {
                      refs[ref2] = [refValue];
                      if (canSetSetupRef(ref2)) {
                        setupState[ref2] = refs[ref2];
                      }
                    } else {
                      const newVal = [refValue];
                      if (canSetRef(ref2, rawRef.k)) {
                        ref2.value = newVal;
                      }
                      if (rawRef.k) refs[rawRef.k] = newVal;
                    }
                  } else if (!existing.includes(refValue)) {
                    existing.push(refValue);
                  }
                }
              } else if (_isString) {
                refs[ref2] = value;
                if (canSetSetupRef(ref2)) {
                  setupState[ref2] = value;
                }
              } else if (_isRef) {
                if (canSetRef(ref2, rawRef.k)) {
                  ref2.value = value;
                }
                if (rawRef.k) refs[rawRef.k] = value;
              } else ;
            };
            if (value) {
              const job = () => {
                doSet();
                pendingSetRefMap.delete(rawRef);
              };
              job.id = -1;
              pendingSetRefMap.set(rawRef, job);
              queuePostRenderEffect(job, parentSuspense);
            } else {
              invalidatePendingSetRef(rawRef);
              doSet();
            }
          }
        }
      }
      function invalidatePendingSetRef(rawRef) {
        const pendingSetRef = pendingSetRefMap.get(rawRef);
        if (pendingSetRef) {
          pendingSetRef.flags |= 8;
          pendingSetRefMap.delete(rawRef);
        }
      }
      var hasLoggedMismatchError = false;
      var logMismatchError = () => {
        if (hasLoggedMismatchError) {
          return;
        }
        console.error("Hydration completed but contains mismatches.");
        hasLoggedMismatchError = true;
      };
      var isSVGContainer = (container) => container.namespaceURI.includes("svg") && container.tagName !== "foreignObject";
      var isMathMLContainer = (container) => container.namespaceURI.includes("MathML");
      var getContainerType = (container) => {
        if (container.nodeType !== 1) return void 0;
        if (isSVGContainer(container)) return "svg";
        if (isMathMLContainer(container)) return "mathml";
        return void 0;
      };
      var isComment = (node) => node.nodeType === 8;
      function createHydrationFunctions(rendererInternals) {
        const {
          mt: mountComponent,
          p: patch,
          o: {
            patchProp,
            createText,
            nextSibling,
            parentNode,
            remove,
            insert,
            createComment
          }
        } = rendererInternals;
        const hydrate = (vnode, container) => {
          if (!container.hasChildNodes()) {
            patch(null, vnode, container);
            flushPostFlushCbs();
            container._vnode = vnode;
            return;
          }
          hydrateNode(container.firstChild, vnode, null, null, null);
          flushPostFlushCbs();
          container._vnode = vnode;
        };
        const hydrateNode = (node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized = false) => {
          optimized = optimized || !!vnode.dynamicChildren;
          const isFragmentStart = isComment(node) && node.data === "[";
          const onMismatch = () => handleMismatch(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            isFragmentStart
          );
          const { type, ref: ref2, shapeFlag, patchFlag } = vnode;
          let domType = node.nodeType;
          vnode.el = node;
          if (patchFlag === -2) {
            optimized = false;
            vnode.dynamicChildren = null;
          }
          let nextNode = null;
          switch (type) {
            case Text:
              if (domType !== 3) {
                if (vnode.children === "") {
                  insert(vnode.el = createText(""), parentNode(node), node);
                  nextNode = node;
                } else {
                  nextNode = onMismatch();
                }
              } else {
                if (node.data !== vnode.children) {
                  logMismatchError();
                  node.data = vnode.children;
                }
                nextNode = nextSibling(node);
              }
              break;
            case Comment:
              if (isTemplateNode(node)) {
                nextNode = nextSibling(node);
                replaceNode(
                  vnode.el = node.content.firstChild,
                  node,
                  parentComponent
                );
              } else if (domType !== 8 || isFragmentStart) {
                nextNode = onMismatch();
              } else {
                nextNode = nextSibling(node);
              }
              break;
            case Static:
              if (isFragmentStart) {
                node = nextSibling(node);
                domType = node.nodeType;
              }
              if (domType === 1 || domType === 3) {
                nextNode = node;
                const needToAdoptContent = !vnode.children.length;
                for (let i = 0; i < vnode.staticCount; i++) {
                  if (needToAdoptContent)
                    vnode.children += nextNode.nodeType === 1 ? nextNode.outerHTML : nextNode.data;
                  if (i === vnode.staticCount - 1) {
                    vnode.anchor = nextNode;
                  }
                  nextNode = nextSibling(nextNode);
                }
                return isFragmentStart ? nextSibling(nextNode) : nextNode;
              } else {
                onMismatch();
              }
              break;
            case Fragment:
              if (!isFragmentStart) {
                nextNode = onMismatch();
              } else {
                nextNode = hydrateFragment(
                  node,
                  vnode,
                  parentComponent,
                  parentSuspense,
                  slotScopeIds,
                  optimized
                );
              }
              break;
            default:
              if (shapeFlag & 1) {
                if ((domType !== 1 || vnode.type.toLowerCase() !== node.tagName.toLowerCase()) && !isTemplateNode(node)) {
                  nextNode = onMismatch();
                } else {
                  nextNode = hydrateElement(
                    node,
                    vnode,
                    parentComponent,
                    parentSuspense,
                    slotScopeIds,
                    optimized
                  );
                }
              } else if (shapeFlag & 6) {
                vnode.slotScopeIds = slotScopeIds;
                const container = parentNode(node);
                if (isFragmentStart) {
                  nextNode = locateClosingAnchor(node);
                } else if (isComment(node) && node.data === "teleport start") {
                  nextNode = locateClosingAnchor(node, node.data, "teleport end");
                } else {
                  nextNode = nextSibling(node);
                }
                mountComponent(
                  vnode,
                  container,
                  null,
                  parentComponent,
                  parentSuspense,
                  getContainerType(container),
                  optimized
                );
                if (isAsyncWrapper(vnode) && !vnode.component.subTree) {
                  let subTree;
                  if (isFragmentStart) {
                    subTree = createVNode(Static);
                    subTree.anchor = nextNode ? nextNode.previousSibling : container.lastChild;
                  } else {
                    subTree = node.nodeType === 3 ? createTextVNode("") : createVNode("div");
                  }
                  subTree.el = node;
                  vnode.component.subTree = subTree;
                }
              } else if (shapeFlag & 64) {
                if (domType !== 8) {
                  nextNode = onMismatch();
                } else {
                  nextNode = vnode.type.hydrate(
                    node,
                    vnode,
                    parentComponent,
                    parentSuspense,
                    slotScopeIds,
                    optimized,
                    rendererInternals,
                    hydrateChildren
                  );
                }
              } else if (shapeFlag & 128) {
                nextNode = vnode.type.hydrate(
                  node,
                  vnode,
                  parentComponent,
                  parentSuspense,
                  getContainerType(parentNode(node)),
                  slotScopeIds,
                  optimized,
                  rendererInternals,
                  hydrateNode
                );
              } else ;
          }
          if (ref2 != null) {
            setRef(ref2, null, parentSuspense, vnode);
          }
          return nextNode;
        };
        const hydrateElement = (el, vnode, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          optimized = optimized || !!vnode.dynamicChildren;
          const {
            type,
            dynamicProps,
            props,
            patchFlag,
            shapeFlag,
            dirs,
            transition
          } = vnode;
          const forcePatch = type === "input" || type === "option";
          const hasDynamicProps = !!dynamicProps;
          if (forcePatch || hasDynamicProps || patchFlag !== -1) {
            if (dirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "created");
            }
            let needCallTransitionHooks = false;
            if (isTemplateNode(el)) {
              needCallTransitionHooks = needTransition(
                null,
                // no need check parentSuspense in hydration
                transition
              ) && parentComponent && parentComponent.vnode.props && parentComponent.vnode.props.appear;
              const content = el.content.firstChild;
              if (needCallTransitionHooks) {
                const cls = content.getAttribute("class");
                if (cls) content.$cls = cls;
                transition.beforeEnter(content);
              }
              replaceNode(content, el, parentComponent);
              vnode.el = el = content;
            }
            if (shapeFlag & 16 && // skip if element has innerHTML / textContent
            !(props && (props.innerHTML || props.textContent))) {
              let next = hydrateChildren(
                el.firstChild,
                vnode,
                el,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
              if (next && !isMismatchAllowed(
                el,
                1
                /* CHILDREN */
              )) {
                logMismatchError();
              }
              while (next) {
                const cur = next;
                next = next.nextSibling;
                remove(cur);
              }
            } else if (shapeFlag & 8) {
              let clientText = vnode.children;
              if (clientText[0] === "\n" && (el.tagName === "PRE" || el.tagName === "TEXTAREA")) {
                clientText = clientText.slice(1);
              }
              const { textContent } = el;
              if (textContent !== clientText && // innerHTML normalize \r\n or \r into a single \n in the DOM
              textContent !== clientText.replace(/\r\n|\r/g, "\n")) {
                if (!isMismatchAllowed(
                  el,
                  0
                  /* TEXT */
                )) {
                  logMismatchError();
                }
                el.textContent = vnode.children;
              }
            }
            if (props) {
              if (forcePatch || hasDynamicProps || !optimized || patchFlag & (16 | 32)) {
                const isCustomElement = el.tagName.includes("-");
                const namespace = el.namespaceURI.includes("svg") ? "svg" : el.namespaceURI.includes("MathML") ? "mathml" : void 0;
                for (const key in props) {
                  if (forcePatch && (key.endsWith("value") || key === "indeterminate") || shared.isOn(key) && !shared.isReservedProp(key) || // force hydrate v-bind with .prop modifiers
                  key[0] === "." || isCustomElement && !shared.isReservedProp(key) || dynamicProps && dynamicProps.includes(key)) {
                    if (isUnchangedResourceProp(el, key, props[key])) {
                      continue;
                    }
                    patchProp(el, key, null, props[key], namespace, parentComponent);
                  }
                }
              } else if (props.onClick) {
                patchProp(
                  el,
                  "onClick",
                  null,
                  props.onClick,
                  void 0,
                  parentComponent
                );
              } else if (patchFlag & 4 && reactivity.isReactive(props.style)) {
                for (const key in props.style) props.style[key];
              }
            }
            let vnodeHooks;
            if (vnodeHooks = props && props.onVnodeBeforeMount) {
              invokeVNodeHook(vnodeHooks, parentComponent, vnode);
            }
            if (dirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
            }
            if ((vnodeHooks = props && props.onVnodeMounted) || dirs || needCallTransitionHooks) {
              queueEffectWithSuspense(() => {
                vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode);
                needCallTransitionHooks && transition.enter(el);
                dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
              }, parentSuspense);
            }
          }
          return el.nextSibling;
        };
        const hydrateChildren = (node, parentVNode, container, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          optimized = optimized || !!parentVNode.dynamicChildren;
          const children = parentVNode.children;
          const l = children.length;
          let hasCheckedMismatch = false;
          for (let i = 0; i < l; i++) {
            const vnode = optimized ? children[i] : children[i] = normalizeVNode(children[i]);
            const isText = vnode.type === Text;
            if (node) {
              if (isText && !optimized) {
                if (i + 1 < l && normalizeVNode(children[i + 1]).type === Text) {
                  insert(
                    createText(
                      node.data.slice(vnode.children.length)
                    ),
                    container,
                    nextSibling(node)
                  );
                  node.data = vnode.children;
                }
              }
              node = hydrateNode(
                node,
                vnode,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
            } else if (isText && !vnode.children) {
              insert(vnode.el = createText(""), container);
            } else {
              if (!hasCheckedMismatch) {
                hasCheckedMismatch = true;
                if (!isMismatchAllowed(
                  container,
                  1
                  /* CHILDREN */
                )) {
                  logMismatchError();
                }
              }
              patch(
                null,
                vnode,
                container,
                null,
                parentComponent,
                parentSuspense,
                getContainerType(container),
                slotScopeIds
              );
            }
          }
          return node;
        };
        const hydrateFragment = (node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          const { slotScopeIds: fragmentSlotScopeIds } = vnode;
          if (fragmentSlotScopeIds) {
            slotScopeIds = slotScopeIds ? slotScopeIds.concat(fragmentSlotScopeIds) : fragmentSlotScopeIds;
          }
          const container = parentNode(node);
          const next = hydrateChildren(
            nextSibling(node),
            vnode,
            container,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          );
          if (next && isComment(next) && next.data === "]") {
            return nextSibling(vnode.anchor = next);
          } else {
            logMismatchError();
            insert(vnode.anchor = createComment(`]`), container, next);
            return next;
          }
        };
        const handleMismatch = (node, vnode, parentComponent, parentSuspense, slotScopeIds, isFragment) => {
          if (!isNodeMismatchAllowed(node, vnode)) {
            logMismatchError();
          }
          vnode.el = null;
          if (isFragment) {
            const end = locateClosingAnchor(node);
            while (true) {
              const next2 = nextSibling(node);
              if (next2 && next2 !== end) {
                remove(next2);
              } else {
                break;
              }
            }
          }
          const next = nextSibling(node);
          const container = parentNode(node);
          remove(node);
          patch(
            null,
            vnode,
            container,
            next,
            parentComponent,
            parentSuspense,
            getContainerType(container),
            slotScopeIds
          );
          if (parentComponent) {
            parentComponent.vnode.el = vnode.el;
            updateHOCHostEl(parentComponent, vnode.el);
          }
          return next;
        };
        const locateClosingAnchor = (node, open = "[", close = "]") => {
          let match = 0;
          while (node) {
            node = nextSibling(node);
            if (node && isComment(node)) {
              if (node.data === open) match++;
              if (node.data === close) {
                if (match === 0) {
                  return nextSibling(node);
                } else {
                  match--;
                }
              }
            }
          }
          return node;
        };
        const replaceNode = (newNode, oldNode, parentComponent) => {
          const parentNode2 = oldNode.parentNode;
          if (parentNode2) {
            parentNode2.replaceChild(newNode, oldNode);
          }
          let parent = parentComponent;
          while (parent) {
            if (parent.vnode.el === oldNode) {
              parent.vnode.el = parent.subTree.el = newNode;
            }
            parent = parent.parent;
          }
        };
        const isTemplateNode = (node) => {
          return node.nodeType === 1 && node.tagName === "TEMPLATE";
        };
        return [hydrate, hydrateNode];
      }
      var resourceProps = /* @__PURE__ */ new Set(["src", "srcset", "href", "poster"]);
      function isUnchangedResourceProp(el, key, clientValue) {
        if (!resourceProps.has(key)) {
          return false;
        }
        return el.getAttribute(key) === (clientValue == null ? null : `${clientValue}`);
      }
      var allowMismatchAttr = "data-allow-mismatch";
      var MismatchTypeString = {
        [
          0
          /* TEXT */
        ]: "text",
        [
          1
          /* CHILDREN */
        ]: "children",
        [
          2
          /* CLASS */
        ]: "class",
        [
          3
          /* STYLE */
        ]: "style",
        [
          4
          /* ATTRIBUTE */
        ]: "attribute"
      };
      function isMismatchAllowed(el, allowedType) {
        if (allowedType === 0 || allowedType === 1) {
          while (el && !el.hasAttribute(allowMismatchAttr)) {
            el = el.parentElement;
          }
        }
        return isMismatchAllowedByAttr(
          el && el.getAttribute(allowMismatchAttr),
          allowedType
        );
      }
      function isMismatchAllowedByAttr(allowedAttr, allowedType) {
        if (allowedAttr == null) {
          return false;
        } else if (allowedAttr === "") {
          return true;
        } else {
          const list = allowedAttr.split(",");
          if (allowedType === 0 && list.includes("children")) {
            return true;
          }
          return list.includes(MismatchTypeString[allowedType]);
        }
      }
      function isNodeMismatchAllowed(node, vnode) {
        return isMismatchAllowed(
          node.parentElement,
          1
          /* CHILDREN */
        ) || isMismatchAllowedByNode(node) || isMismatchAllowedByVNode(vnode);
      }
      function isMismatchAllowedByNode(node) {
        return node.nodeType === 1 && isMismatchAllowedByAttr(
          node.getAttribute(allowMismatchAttr),
          1
          /* CHILDREN */
        );
      }
      function isMismatchAllowedByVNode({ props }) {
        const allowedAttr = props && props[allowMismatchAttr];
        return typeof allowedAttr === "string" && isMismatchAllowedByAttr(
          allowedAttr,
          1
          /* CHILDREN */
        );
      }
      var requestIdleCallback = shared.getGlobalThis().requestIdleCallback || ((cb) => setTimeout(cb, 1));
      var cancelIdleCallback = shared.getGlobalThis().cancelIdleCallback || ((id) => clearTimeout(id));
      var hydrateOnIdle = (timeout = 1e4) => (hydrate) => {
        const id = requestIdleCallback(hydrate, { timeout });
        return () => cancelIdleCallback(id);
      };
      function elementIsVisibleInViewport(el) {
        const { top, left, bottom, right } = el.getBoundingClientRect();
        const { innerHeight, innerWidth } = window;
        return (top > 0 && top < innerHeight || bottom > 0 && bottom < innerHeight) && (left > 0 && left < innerWidth || right > 0 && right < innerWidth);
      }
      var hydrateOnVisible = (opts) => (hydrate, forEach) => {
        const ob = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            ob.disconnect();
            hydrate();
            break;
          }
        }, opts);
        forEach((el) => {
          if (!(el instanceof Element)) return;
          if (elementIsVisibleInViewport(el)) {
            hydrate();
            ob.disconnect();
            return false;
          }
          ob.observe(el);
        });
        return () => ob.disconnect();
      };
      var hydrateOnMediaQuery = (query) => (hydrate) => {
        if (query) {
          const mql = matchMedia(query);
          if (mql.matches) {
            hydrate();
          } else {
            mql.addEventListener("change", hydrate, { once: true });
            return () => mql.removeEventListener("change", hydrate);
          }
        }
      };
      var hydrateOnInteraction = (interactions = []) => (hydrate, forEach) => {
        if (shared.isString(interactions)) interactions = [interactions];
        let hasHydrated = false;
        const doHydrate = (e) => {
          if (!hasHydrated) {
            hasHydrated = true;
            teardown();
            hydrate();
            e.target.dispatchEvent(new e.constructor(e.type, e));
          }
        };
        const teardown = () => {
          forEach((el) => {
            for (const i of interactions) {
              el.removeEventListener(i, doHydrate);
            }
          });
        };
        forEach((el) => {
          for (const i of interactions) {
            el.addEventListener(i, doHydrate, { once: true });
          }
        });
        return teardown;
      };
      function forEachElement(node, cb) {
        if (isComment(node) && node.data === "[") {
          let depth = 1;
          let next = node.nextSibling;
          while (next) {
            if (next.nodeType === 1) {
              const result = cb(next);
              if (result === false) {
                break;
              }
            } else if (isComment(next)) {
              if (next.data === "]") {
                if (--depth === 0) break;
              } else if (next.data === "[") {
                depth++;
              }
            }
            next = next.nextSibling;
          }
        } else {
          cb(node);
        }
      }
      var isAsyncWrapper = (i) => !!i.type.__asyncLoader;
      // @__NO_SIDE_EFFECTS__
      function defineAsyncComponent(source) {
        if (shared.isFunction(source)) {
          source = { loader: source };
        }
        const {
          loader,
          loadingComponent,
          errorComponent,
          delay = 200,
          hydrate: hydrateStrategy,
          timeout,
          // undefined = never times out
          suspensible = true,
          onError: userOnError
        } = source;
        let pendingRequest = null;
        let resolvedComp;
        let retries = 0;
        const retry = () => {
          retries++;
          pendingRequest = null;
          return load();
        };
        const load = () => {
          let thisRequest;
          return pendingRequest || (thisRequest = pendingRequest = loader().catch((err) => {
            err = err instanceof Error ? err : new Error(String(err));
            if (userOnError) {
              return new Promise((resolve2, reject) => {
                const userRetry = () => resolve2(retry());
                const userFail = () => reject(err);
                userOnError(err, userRetry, userFail, retries + 1);
              });
            } else {
              throw err;
            }
          }).then((comp) => {
            if (thisRequest !== pendingRequest && pendingRequest) {
              return pendingRequest;
            }
            if (comp && (comp.__esModule || comp[Symbol.toStringTag] === "Module")) {
              comp = comp.default;
            }
            resolvedComp = comp;
            return comp;
          }));
        };
        return /* @__PURE__ */ defineComponent({
          name: "AsyncComponentWrapper",
          __asyncLoader: load,
          __asyncHydrate(el, instance, hydrate) {
            const wasConnected = el.isConnected;
            let patched = false;
            (instance.bu || (instance.bu = [])).push(() => patched = true);
            const performHydrate = () => {
              if (patched) {
                return;
              }
              if (!el.parentNode || wasConnected && !el.isConnected) return;
              hydrate();
            };
            const doHydrate = hydrateStrategy ? () => {
              const teardown = hydrateStrategy(
                performHydrate,
                (cb) => forEachElement(el, cb)
              );
              if (teardown) {
                (instance.bum || (instance.bum = [])).push(teardown);
              }
            } : performHydrate;
            if (resolvedComp) {
              doHydrate();
            } else {
              load().then(() => !instance.isUnmounted && doHydrate());
            }
          },
          get __asyncResolved() {
            return resolvedComp;
          },
          setup() {
            const instance = currentInstance;
            markAsyncBoundary(instance);
            if (resolvedComp) {
              return () => createInnerComp(resolvedComp, instance);
            }
            const onError = (err) => {
              pendingRequest = null;
              handleError(
                err,
                instance,
                13,
                !errorComponent
              );
            };
            if (suspensible && instance.suspense || isInSSRComponentSetup) {
              return load().then((comp) => {
                return () => createInnerComp(comp, instance);
              }).catch((err) => {
                onError(err);
                return () => errorComponent ? createVNode(errorComponent, {
                  error: err
                }) : null;
              });
            }
            const loaded = reactivity.ref(false);
            const error = reactivity.ref();
            const delayed = reactivity.ref(!!delay);
            let timeoutTimer;
            let delayTimer;
            onUnmounted(() => {
              if (timeoutTimer != null) clearTimeout(timeoutTimer);
              if (delayTimer != null) clearTimeout(delayTimer);
            });
            if (delay) {
              delayTimer = setTimeout(() => {
                if (instance.isUnmounted) return;
                delayed.value = false;
              }, delay);
            }
            if (timeout != null) {
              timeoutTimer = setTimeout(() => {
                if (instance.isUnmounted) return;
                if (!loaded.value && !error.value) {
                  const err = new Error(
                    `Async component timed out after ${timeout}ms.`
                  );
                  onError(err);
                  error.value = err;
                }
              }, timeout);
            }
            load().then(() => {
              if (instance.isUnmounted) return;
              loaded.value = true;
              if (instance.parent && isKeepAlive(instance.parent.vnode)) {
                instance.parent.update();
              }
            }).catch((err) => {
              if (instance.isUnmounted) {
                pendingRequest = null;
                return;
              }
              onError(err);
              error.value = err;
            });
            return () => {
              if (loaded.value && resolvedComp) {
                return createInnerComp(resolvedComp, instance);
              } else if (error.value && errorComponent) {
                return createVNode(errorComponent, {
                  error: error.value
                });
              } else if (loadingComponent && !delayed.value) {
                return createInnerComp(
                  loadingComponent,
                  instance
                );
              }
            };
          }
        });
      }
      function createInnerComp(comp, parent) {
        const { ref: ref2, props, children, ce } = parent.vnode;
        const vnode = createVNode(comp, props, children);
        vnode.ref = ref2;
        vnode.ce = ce;
        delete parent.vnode.ce;
        return vnode;
      }
      var isKeepAlive = (vnode) => vnode.type.__isKeepAlive;
      var KeepAliveImpl = {
        name: `KeepAlive`,
        // Marker for special handling inside the renderer. We are not using a ===
        // check directly on KeepAlive in the renderer, because importing it directly
        // would prevent it from being tree-shaken.
        __isKeepAlive: true,
        props: {
          include: [String, RegExp, Array],
          exclude: [String, RegExp, Array],
          max: [String, Number]
        },
        setup(props, { slots }) {
          const instance = getCurrentInstance2();
          const sharedContext = instance.ctx;
          if (!sharedContext.renderer) {
            return () => {
              const children = slots.default && slots.default();
              return children && children.length === 1 ? children[0] : children;
            };
          }
          const cache = /* @__PURE__ */ new Map();
          const keys = /* @__PURE__ */ new Set();
          let current = null;
          const parentSuspense = instance.suspense;
          const {
            renderer: {
              p: patch,
              m: move,
              um: _unmount,
              o: { createElement }
            }
          } = sharedContext;
          const storageContainer = createElement("div");
          sharedContext.activate = (vnode, container, anchor, namespace, optimized) => {
            const instance2 = vnode.component;
            move(vnode, container, anchor, 0, parentSuspense);
            patch(
              instance2.vnode,
              vnode,
              container,
              anchor,
              instance2,
              parentSuspense,
              namespace,
              vnode.slotScopeIds,
              optimized
            );
            queuePostRenderEffect(() => {
              instance2.isDeactivated = false;
              if (instance2.a) {
                shared.invokeArrayFns(instance2.a);
              }
              const vnodeHook = vnode.props && vnode.props.onVnodeMounted;
              if (vnodeHook) {
                invokeVNodeHook(vnodeHook, instance2.parent, vnode);
              }
            }, parentSuspense);
          };
          sharedContext.deactivate = (vnode) => {
            const instance2 = vnode.component;
            invalidateMount(instance2.m);
            invalidateMount(instance2.a);
            move(vnode, storageContainer, null, 1, parentSuspense);
            queuePostRenderEffect(() => {
              if (instance2.da) {
                shared.invokeArrayFns(instance2.da);
              }
              const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted;
              if (vnodeHook) {
                invokeVNodeHook(vnodeHook, instance2.parent, vnode);
              }
              instance2.isDeactivated = true;
            }, parentSuspense);
          };
          function unmount(vnode) {
            resetShapeFlag(vnode);
            _unmount(vnode, instance, parentSuspense, true);
          }
          function pruneCache(filter) {
            cache.forEach((vnode, key) => {
              const name = getComponentName(
                isAsyncWrapper(vnode) ? vnode.type.__asyncResolved || {} : vnode.type
              );
              if (name && !filter(name)) {
                pruneCacheEntry(key);
              }
            });
          }
          function pruneCacheEntry(key) {
            const cached = cache.get(key);
            if (cached && (!current || !isSameVNodeType(cached, current))) {
              unmount(cached);
            } else if (current) {
              resetShapeFlag(current);
            }
            cache.delete(key);
            keys.delete(key);
          }
          watch(
            () => [props.include, props.exclude],
            ([include, exclude]) => {
              include && pruneCache((name) => matches(include, name));
              exclude && pruneCache((name) => !matches(exclude, name));
            },
            // prune post-render after `current` has been updated
            { flush: "post", deep: true }
          );
          let pendingCacheKey = null;
          const cacheSubtree = () => {
            if (pendingCacheKey != null) {
              if (isSuspense(instance.subTree.type)) {
                queuePostRenderEffect(() => {
                  const vnode = getInnerChild(instance.subTree);
                  if (vnode.component) {
                    cache.set(pendingCacheKey, vnode);
                  }
                }, instance.subTree.suspense);
              } else {
                cache.set(pendingCacheKey, getInnerChild(instance.subTree));
              }
            }
          };
          onMounted(cacheSubtree);
          onUpdated(cacheSubtree);
          onBeforeUnmount(() => {
            cache.forEach((cached) => {
              const { subTree, suspense } = instance;
              const vnode = getInnerChild(subTree);
              if (cached.type === vnode.type && cached.key === vnode.key) {
                resetShapeFlag(vnode);
                const da = vnode.component.da;
                da && queuePostRenderEffect(da, suspense);
                return;
              }
              unmount(cached);
            });
          });
          return () => {
            pendingCacheKey = null;
            if (!slots.default) {
              return current = null;
            }
            const children = slots.default();
            const rawVNode = children[0];
            if (children.length > 1) {
              current = null;
              return children;
            } else if (!isVNode(rawVNode) || !(rawVNode.shapeFlag & 4) && !(rawVNode.shapeFlag & 128)) {
              current = null;
              return rawVNode;
            }
            let vnode = getInnerChild(rawVNode);
            if (vnode.type === Comment) {
              current = null;
              return vnode;
            }
            const comp = vnode.type;
            const name = getComponentName(
              isAsyncWrapper(vnode) ? vnode.type.__asyncResolved || {} : comp
            );
            const { include, exclude, max } = props;
            if (include && (!name || !matches(include, name)) || exclude && name && matches(exclude, name)) {
              vnode.shapeFlag &= -257;
              current = vnode;
              return rawVNode;
            }
            const key = vnode.key == null ? comp : vnode.key;
            const cachedVNode = cache.get(key);
            if (vnode.el) {
              vnode = cloneVNode(vnode);
              if (rawVNode.shapeFlag & 128) {
                rawVNode.ssContent = vnode;
              }
            }
            pendingCacheKey = key;
            if (cachedVNode) {
              vnode.el = cachedVNode.el;
              vnode.component = cachedVNode.component;
              if (vnode.transition) {
                setTransitionHooks(vnode, vnode.transition);
              }
              vnode.shapeFlag |= 512;
              keys.delete(key);
              keys.add(key);
            } else {
              keys.add(key);
              if (max && keys.size > parseInt(max, 10)) {
                pruneCacheEntry(keys.values().next().value);
              }
            }
            vnode.shapeFlag |= 256;
            current = vnode;
            return isSuspense(rawVNode.type) ? rawVNode : vnode;
          };
        }
      };
      var KeepAlive = KeepAliveImpl;
      function matches(pattern, name) {
        if (shared.isArray(pattern)) {
          return pattern.some((p) => matches(p, name));
        } else if (shared.isString(pattern)) {
          return pattern.split(",").includes(name);
        } else if (shared.isRegExp(pattern)) {
          pattern.lastIndex = 0;
          return pattern.test(name);
        }
        return false;
      }
      function onActivated(hook, target) {
        registerKeepAliveHook(hook, "a", target);
      }
      function onDeactivated(hook, target) {
        registerKeepAliveHook(hook, "da", target);
      }
      function registerKeepAliveHook(hook, type, target = currentInstance) {
        const wrappedHook = hook.__wdc || (hook.__wdc = () => {
          let current = target;
          while (current) {
            if (current.isDeactivated) {
              return;
            }
            current = current.parent;
          }
          return hook();
        });
        injectHook(type, wrappedHook, target);
        if (target) {
          let current = target.parent;
          while (current && current.parent) {
            if (isKeepAlive(current.parent.vnode)) {
              injectToKeepAliveRoot(wrappedHook, type, target, current);
            }
            current = current.parent;
          }
        }
      }
      function injectToKeepAliveRoot(hook, type, target, keepAliveRoot) {
        const injected = injectHook(
          type,
          hook,
          keepAliveRoot,
          true
          /* prepend */
        );
        onUnmounted(() => {
          shared.remove(keepAliveRoot[type], injected);
        }, target);
      }
      function resetShapeFlag(vnode) {
        vnode.shapeFlag &= -257;
        vnode.shapeFlag &= -513;
      }
      function getInnerChild(vnode) {
        return vnode.shapeFlag & 128 ? vnode.ssContent : vnode;
      }
      function injectHook(type, hook, target = currentInstance, prepend = false) {
        if (target) {
          const hooks = target[type] || (target[type] = []);
          const wrappedHook = hook.__weh || (hook.__weh = (...args) => {
            reactivity.pauseTracking();
            const reset = setCurrentInstance(target);
            const res = callWithAsyncErrorHandling(hook, target, type, args);
            reset();
            reactivity.resetTracking();
            return res;
          });
          if (prepend) {
            hooks.unshift(wrappedHook);
          } else {
            hooks.push(wrappedHook);
          }
          return wrappedHook;
        }
      }
      var createHook = (lifecycle) => (hook, target = currentInstance) => {
        if (!isInSSRComponentSetup || lifecycle === "sp") {
          injectHook(lifecycle, (...args) => hook(...args), target);
        }
      };
      var onBeforeMount = createHook("bm");
      var onMounted = createHook("m");
      var onBeforeUpdate = createHook(
        "bu"
      );
      var onUpdated = createHook("u");
      var onBeforeUnmount = createHook(
        "bum"
      );
      var onUnmounted = createHook("um");
      var onServerPrefetch = createHook(
        "sp"
      );
      var onRenderTriggered = createHook("rtg");
      var onRenderTracked = createHook("rtc");
      function onErrorCaptured(hook, target = currentInstance) {
        injectHook("ec", hook, target);
      }
      var COMPONENTS = "components";
      var DIRECTIVES = "directives";
      function resolveComponent(name, maybeSelfReference) {
        return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name;
      }
      var NULL_DYNAMIC_COMPONENT = /* @__PURE__ */ Symbol.for("v-ndc");
      function resolveDynamicComponent(component) {
        if (shared.isString(component)) {
          return resolveAsset(COMPONENTS, component, false) || component;
        } else {
          return component || NULL_DYNAMIC_COMPONENT;
        }
      }
      function resolveDirective(name) {
        return resolveAsset(DIRECTIVES, name);
      }
      function resolveAsset(type, name, warnMissing = true, maybeSelfReference = false) {
        const instance = currentRenderingInstance || currentInstance;
        if (instance) {
          const Component = instance.type;
          if (type === COMPONENTS) {
            const selfName = getComponentName(
              Component,
              false
            );
            if (selfName && (selfName === name || selfName === shared.camelize(name) || selfName === shared.capitalize(shared.camelize(name)))) {
              return Component;
            }
          }
          const res = (
            // local registration
            // check instance[type] first which is resolved for options API
            resolve(instance[type] || Component[type], name) || // global registration
            resolve(instance.appContext[type], name)
          );
          if (!res && maybeSelfReference) {
            return Component;
          }
          return res;
        }
      }
      function resolve(registry, name) {
        return registry && (registry[name] || registry[shared.camelize(name)] || registry[shared.capitalize(shared.camelize(name))]);
      }
      function renderList(source, renderItem, cache, index) {
        let ret;
        const cached = cache && cache[index];
        const sourceIsArray = shared.isArray(source);
        if (sourceIsArray || shared.isString(source)) {
          const sourceIsReactiveArray = sourceIsArray && reactivity.isReactive(source);
          let needsWrap = false;
          let isReadonlySource = false;
          if (sourceIsReactiveArray) {
            needsWrap = !reactivity.isShallow(source);
            isReadonlySource = reactivity.isReadonly(source);
            source = reactivity.shallowReadArray(source);
          }
          ret = new Array(source.length);
          for (let i = 0, l = source.length; i < l; i++) {
            ret[i] = renderItem(
              needsWrap ? isReadonlySource ? reactivity.toReadonly(reactivity.toReactive(source[i])) : reactivity.toReactive(source[i]) : source[i],
              i,
              void 0,
              cached && cached[i]
            );
          }
        } else if (typeof source === "number") {
          {
            ret = new Array(source);
            for (let i = 0; i < source; i++) {
              ret[i] = renderItem(i + 1, i, void 0, cached && cached[i]);
            }
          }
        } else if (shared.isObject(source)) {
          if (source[Symbol.iterator]) {
            ret = Array.from(
              source,
              (item, i) => renderItem(item, i, void 0, cached && cached[i])
            );
          } else {
            const keys = Object.keys(source);
            ret = new Array(keys.length);
            for (let i = 0, l = keys.length; i < l; i++) {
              const key = keys[i];
              ret[i] = renderItem(source[key], key, i, cached && cached[i]);
            }
          }
        } else {
          ret = [];
        }
        if (cache) {
          cache[index] = ret;
        }
        return ret;
      }
      function createSlots(slots, dynamicSlots) {
        for (let i = 0; i < dynamicSlots.length; i++) {
          const slot = dynamicSlots[i];
          if (shared.isArray(slot)) {
            for (let j = 0; j < slot.length; j++) {
              slots[slot[j].name] = slot[j].fn;
            }
          } else if (slot) {
            slots[slot.name] = slot.key ? (...args) => {
              const res = slot.fn(...args);
              if (res) res.key = slot.key;
              return res;
            } : slot.fn;
          }
        }
        return slots;
      }
      function renderSlot(slots, name, props, fallback, noSlotted, branchKey) {
        if (props == null) props = {};
        if (currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce) {
          const slotProps = branchKey != null && props.key == null ? shared.extend({}, props, { key: branchKey }) : props;
          const hasProps = Object.keys(slotProps).length > 0;
          if (name !== "default") slotProps.name = name;
          return openBlock(), createBlock(
            Fragment,
            null,
            [createVNode("slot", slotProps, fallback && fallback())],
            hasProps ? -2 : 64
          );
        }
        let slot = slots[name];
        if (slot && slot._c) {
          slot._d = false;
        }
        const prevStackSize = blockStack.length;
        openBlock();
        let rendered;
        try {
          const validSlotContent = slot && ensureValidVNode(slot(props));
          const slotKey = props.key || branchKey || // slot content array of a dynamic conditional slot may have a branch
          // key attached in the `createSlots` helper, respect that
          validSlotContent && validSlotContent.key;
          rendered = createBlock(
            Fragment,
            {
              key: (slotKey && !shared.isSymbol(slotKey) ? slotKey : `_${name}`) + // #7256 force differentiate fallback content from actual content
              (!validSlotContent && fallback ? "_fb" : "")
            },
            validSlotContent || (fallback ? fallback() : []),
            validSlotContent && slots._ === 1 ? 64 : -2
          );
        } catch (err) {
          for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
          throw err;
        } finally {
          if (slot && slot._c) {
            slot._d = true;
          }
        }
        if (!noSlotted && rendered.scopeId) {
          rendered.slotScopeIds = [rendered.scopeId + "-s"];
        }
        return rendered;
      }
      function ensureValidVNode(vnodes) {
        return vnodes.some((child) => {
          if (!isVNode(child)) return true;
          if (child.type === Comment) return false;
          if (child.type === Fragment && !ensureValidVNode(child.children))
            return false;
          return true;
        }) ? vnodes : null;
      }
      function toHandlers(obj, preserveCaseIfNecessary) {
        const ret = {};
        for (const key in obj) {
          ret[preserveCaseIfNecessary && /[A-Z]/.test(key) ? `on:${key}` : shared.toHandlerKey(key)] = obj[key];
        }
        return ret;
      }
      var getPublicInstance = (i) => {
        if (!i) return null;
        if (isStatefulComponent(i)) return getComponentPublicInstance(i);
        return getPublicInstance(i.parent);
      };
      var publicPropertiesMap = (
        // Move PURE marker to new line to workaround compiler discarding it
        // due to type annotation
        /* @__PURE__ */ shared.extend(/* @__PURE__ */ Object.create(null), {
          $: (i) => i,
          $el: (i) => i.vnode.el,
          $data: (i) => i.data,
          $props: (i) => i.props,
          $attrs: (i) => i.attrs,
          $slots: (i) => i.slots,
          $refs: (i) => i.refs,
          $parent: (i) => getPublicInstance(i.parent),
          $root: (i) => getPublicInstance(i.root),
          $host: (i) => i.ce,
          $emit: (i) => i.emit,
          $options: (i) => resolveMergedOptions(i),
          $forceUpdate: (i) => i.f || (i.f = () => {
            queueJob(i.update);
          }),
          $nextTick: (i) => i.n || (i.n = nextTick.bind(i.proxy)),
          $watch: (i) => instanceWatch.bind(i)
        })
      );
      var hasSetupBinding = (state, key) => state !== shared.EMPTY_OBJ && !state.__isScriptSetup && shared.hasOwn(state, key);
      var PublicInstanceProxyHandlers = {
        get({ _: instance }, key) {
          if (key === "__v_skip") {
            return true;
          }
          const { ctx, setupState, data, props, accessCache, type, appContext } = instance;
          if (key[0] !== "$") {
            const n = accessCache[key];
            if (n !== void 0) {
              switch (n) {
                case 1:
                  return setupState[key];
                case 2:
                  return data[key];
                case 4:
                  return ctx[key];
                case 3:
                  return props[key];
              }
            } else if (hasSetupBinding(setupState, key)) {
              accessCache[key] = 1;
              return setupState[key];
            } else if (data !== shared.EMPTY_OBJ && shared.hasOwn(data, key)) {
              accessCache[key] = 2;
              return data[key];
            } else if (shared.hasOwn(props, key)) {
              accessCache[key] = 3;
              return props[key];
            } else if (ctx !== shared.EMPTY_OBJ && shared.hasOwn(ctx, key)) {
              accessCache[key] = 4;
              return ctx[key];
            } else if (shouldCacheAccess) {
              accessCache[key] = 0;
            }
          }
          const publicGetter = publicPropertiesMap[key];
          let cssModule, globalProperties;
          if (publicGetter) {
            if (key === "$attrs") {
              reactivity.track(instance.attrs, "get", "");
            }
            return publicGetter(instance);
          } else if (
            // css module (injected by vue-loader)
            (cssModule = type.__cssModules) && (cssModule = cssModule[key])
          ) {
            return cssModule;
          } else if (ctx !== shared.EMPTY_OBJ && shared.hasOwn(ctx, key)) {
            accessCache[key] = 4;
            return ctx[key];
          } else if (
            // global properties
            globalProperties = appContext.config.globalProperties, shared.hasOwn(globalProperties, key)
          ) {
            {
              return globalProperties[key];
            }
          } else ;
        },
        set({ _: instance }, key, value) {
          const { data, setupState, ctx } = instance;
          if (hasSetupBinding(setupState, key)) {
            setupState[key] = value;
            return true;
          } else if (data !== shared.EMPTY_OBJ && shared.hasOwn(data, key)) {
            data[key] = value;
            return true;
          } else if (shared.hasOwn(instance.props, key)) {
            return false;
          }
          if (key[0] === "$" && key.slice(1) in instance) {
            return false;
          } else {
            {
              ctx[key] = value;
            }
          }
          return true;
        },
        has({
          _: { data, setupState, accessCache, ctx, appContext, props, type }
        }, key) {
          let cssModules;
          return !!(accessCache[key] || data !== shared.EMPTY_OBJ && key[0] !== "$" && shared.hasOwn(data, key) || hasSetupBinding(setupState, key) || shared.hasOwn(props, key) || shared.hasOwn(ctx, key) || shared.hasOwn(publicPropertiesMap, key) || shared.hasOwn(appContext.config.globalProperties, key) || (cssModules = type.__cssModules) && cssModules[key]);
        },
        defineProperty(target, key, descriptor) {
          if (descriptor.get != null) {
            target._.accessCache[key] = 0;
          } else if (shared.hasOwn(descriptor, "value")) {
            this.set(target, key, descriptor.value, null);
          }
          return Reflect.defineProperty(target, key, descriptor);
        }
      };
      var RuntimeCompiledPublicInstanceProxyHandlers = /* @__PURE__ */ shared.extend({}, PublicInstanceProxyHandlers, {
        get(target, key) {
          if (key === Symbol.unscopables) {
            return;
          }
          return PublicInstanceProxyHandlers.get(target, key, target);
        },
        has(_, key) {
          const has = key[0] !== "_" && !shared.isGloballyAllowed(key);
          return has;
        }
      });
      function defineProps() {
        return null;
      }
      function defineEmits() {
        return null;
      }
      function defineExpose(exposed) {
      }
      function defineOptions(options) {
      }
      function defineSlots() {
        return null;
      }
      function defineModel() {
      }
      function withDefaults(props, defaults) {
        return null;
      }
      function useSlots() {
        return getContext().slots;
      }
      function useAttrs() {
        return getContext().attrs;
      }
      function getContext(calledFunctionName) {
        const i = getCurrentInstance2();
        return i.setupContext || (i.setupContext = createSetupContext(i));
      }
      function normalizePropsOrEmits(props) {
        return shared.isArray(props) ? props.reduce(
          (normalized, p) => (normalized[p] = null, normalized),
          {}
        ) : props;
      }
      function mergeDefaults(raw, defaults) {
        const props = normalizePropsOrEmits(raw);
        for (const key in defaults) {
          if (key.startsWith("__skip")) continue;
          let opt = props[key];
          if (opt) {
            if (shared.isArray(opt) || shared.isFunction(opt)) {
              opt = props[key] = { type: opt, default: defaults[key] };
            } else {
              opt.default = defaults[key];
            }
          } else if (opt === null) {
            opt = props[key] = { default: defaults[key] };
          } else ;
          if (opt && defaults[`__skip_${key}`]) {
            opt.skipFactory = true;
          }
        }
        return props;
      }
      function mergeModels(a, b) {
        if (!a || !b) return a || b;
        if (shared.isArray(a) && shared.isArray(b)) return a.concat(b);
        return shared.extend({}, normalizePropsOrEmits(a), normalizePropsOrEmits(b));
      }
      function createPropsRestProxy(props, excludedKeys) {
        const ret = {};
        for (const key in props) {
          if (!excludedKeys.includes(key)) {
            Object.defineProperty(ret, key, {
              enumerable: true,
              get: () => props[key]
            });
          }
        }
        return ret;
      }
      function withAsyncContext(getAwaitable) {
        const ctx = getCurrentInstance2();
        const inSSRSetup = isInSSRComponentSetup;
        let awaitable = getAwaitable();
        unsetCurrentInstance();
        if (inSSRSetup) {
          setInSSRSetupState(false);
        }
        const restore = () => {
          setCurrentInstance(ctx);
          if (inSSRSetup) {
            setInSSRSetupState(true);
          }
        };
        const cleanup = () => {
          if (getCurrentInstance2() !== ctx) ctx.scope.off();
          unsetCurrentInstance();
          if (inSSRSetup) {
            setInSSRSetupState(false);
          }
        };
        if (shared.isPromise(awaitable)) {
          awaitable = awaitable.catch((e) => {
            restore();
            Promise.resolve().then(() => Promise.resolve().then(cleanup));
            throw e;
          });
        }
        return [
          awaitable,
          () => {
            restore();
            Promise.resolve().then(cleanup);
          }
        ];
      }
      var shouldCacheAccess = true;
      function applyOptions(instance) {
        const options = resolveMergedOptions(instance);
        const publicThis = instance.proxy;
        const ctx = instance.ctx;
        shouldCacheAccess = false;
        if (options.beforeCreate) {
          callHook(options.beforeCreate, instance, "bc");
        }
        const {
          // state
          data: dataOptions,
          computed: computedOptions,
          methods,
          watch: watchOptions,
          provide: provideOptions,
          inject: injectOptions,
          // lifecycle
          created,
          beforeMount,
          mounted,
          beforeUpdate,
          updated,
          activated,
          deactivated,
          beforeDestroy,
          beforeUnmount,
          destroyed,
          unmounted,
          render: render2,
          renderTracked,
          renderTriggered,
          errorCaptured,
          serverPrefetch,
          // public API
          expose,
          inheritAttrs,
          // assets
          components,
          directives,
          filters
        } = options;
        const checkDuplicateProperties = null;
        if (injectOptions) {
          resolveInjections(injectOptions, ctx, checkDuplicateProperties);
        }
        if (methods) {
          for (const key in methods) {
            const methodHandler = methods[key];
            if (shared.isFunction(methodHandler)) {
              {
                ctx[key] = methodHandler.bind(publicThis);
              }
            }
          }
        }
        if (dataOptions) {
          const data = dataOptions.call(publicThis, publicThis);
          if (!shared.isObject(data)) ;
          else {
            instance.data = reactivity.reactive(data);
          }
        }
        shouldCacheAccess = true;
        if (computedOptions) {
          for (const key in computedOptions) {
            const opt = computedOptions[key];
            const get = shared.isFunction(opt) ? opt.bind(publicThis, publicThis) : shared.isFunction(opt.get) ? opt.get.bind(publicThis, publicThis) : shared.NOOP;
            const set = !shared.isFunction(opt) && shared.isFunction(opt.set) ? opt.set.bind(publicThis) : shared.NOOP;
            const c = computed({
              get,
              set
            });
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => c.value,
              set: (v) => c.value = v
            });
          }
        }
        if (watchOptions) {
          for (const key in watchOptions) {
            createWatcher(watchOptions[key], ctx, publicThis, key);
          }
        }
        if (provideOptions) {
          const provides = shared.isFunction(provideOptions) ? provideOptions.call(publicThis) : provideOptions;
          Reflect.ownKeys(provides).forEach((key) => {
            provide(key, provides[key]);
          });
        }
        if (created) {
          callHook(created, instance, "c");
        }
        function registerLifecycleHook(register, hook) {
          if (shared.isArray(hook)) {
            hook.forEach((_hook) => register(_hook.bind(publicThis)));
          } else if (hook) {
            register(hook.bind(publicThis));
          }
        }
        registerLifecycleHook(onBeforeMount, beforeMount);
        registerLifecycleHook(onMounted, mounted);
        registerLifecycleHook(onBeforeUpdate, beforeUpdate);
        registerLifecycleHook(onUpdated, updated);
        registerLifecycleHook(onActivated, activated);
        registerLifecycleHook(onDeactivated, deactivated);
        registerLifecycleHook(onErrorCaptured, errorCaptured);
        registerLifecycleHook(onRenderTracked, renderTracked);
        registerLifecycleHook(onRenderTriggered, renderTriggered);
        registerLifecycleHook(onBeforeUnmount, beforeUnmount);
        registerLifecycleHook(onUnmounted, unmounted);
        registerLifecycleHook(onServerPrefetch, serverPrefetch);
        if (shared.isArray(expose)) {
          if (expose.length) {
            const exposed = instance.exposed || (instance.exposed = {});
            expose.forEach((key) => {
              Object.defineProperty(exposed, key, {
                get: () => publicThis[key],
                set: (val) => publicThis[key] = val,
                enumerable: true
              });
            });
          } else if (!instance.exposed) {
            instance.exposed = {};
          }
        }
        if (render2 && instance.render === shared.NOOP) {
          instance.render = render2;
        }
        if (inheritAttrs != null) {
          instance.inheritAttrs = inheritAttrs;
        }
        if (components) instance.components = components;
        if (directives) instance.directives = directives;
        if (serverPrefetch) {
          markAsyncBoundary(instance);
        }
      }
      function resolveInjections(injectOptions, ctx, checkDuplicateProperties = shared.NOOP) {
        if (shared.isArray(injectOptions)) {
          injectOptions = normalizeInject(injectOptions);
        }
        for (const key in injectOptions) {
          const opt = injectOptions[key];
          let injected;
          if (shared.isObject(opt)) {
            if ("default" in opt) {
              injected = inject(
                opt.from || key,
                opt.default,
                true
              );
            } else {
              injected = inject(opt.from || key);
            }
          } else {
            injected = inject(opt);
          }
          if (reactivity.isRef(injected)) {
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => injected.value,
              set: (v) => injected.value = v
            });
          } else {
            ctx[key] = injected;
          }
        }
      }
      function callHook(hook, instance, type) {
        callWithAsyncErrorHandling(
          shared.isArray(hook) ? hook.map((h2) => h2.bind(instance.proxy)) : hook.bind(instance.proxy),
          instance,
          type
        );
      }
      function createWatcher(raw, ctx, publicThis, key) {
        let getter = key.includes(".") ? createPathGetter(publicThis, key) : () => publicThis[key];
        if (shared.isString(raw)) {
          const handler = ctx[raw];
          if (shared.isFunction(handler)) {
            {
              watch(getter, handler);
            }
          }
        } else if (shared.isFunction(raw)) {
          {
            watch(getter, raw.bind(publicThis));
          }
        } else if (shared.isObject(raw)) {
          if (shared.isArray(raw)) {
            raw.forEach((r) => createWatcher(r, ctx, publicThis, key));
          } else {
            const handler = shared.isFunction(raw.handler) ? raw.handler.bind(publicThis) : ctx[raw.handler];
            if (shared.isFunction(handler)) {
              watch(getter, handler, raw);
            }
          }
        } else ;
      }
      function resolveMergedOptions(instance) {
        const base = instance.type;
        const { mixins, extends: extendsOptions } = base;
        const {
          mixins: globalMixins,
          optionsCache: cache,
          config: { optionMergeStrategies }
        } = instance.appContext;
        const cached = cache.get(base);
        let resolved;
        if (cached) {
          resolved = cached;
        } else if (!globalMixins.length && !mixins && !extendsOptions) {
          {
            resolved = base;
          }
        } else {
          resolved = {};
          if (globalMixins.length) {
            globalMixins.forEach(
              (m) => mergeOptions(resolved, m, optionMergeStrategies, true)
            );
          }
          mergeOptions(resolved, base, optionMergeStrategies);
        }
        if (shared.isObject(base)) {
          cache.set(base, resolved);
        }
        return resolved;
      }
      function mergeOptions(to, from, strats, asMixin = false) {
        const { mixins, extends: extendsOptions } = from;
        if (extendsOptions) {
          mergeOptions(to, extendsOptions, strats, true);
        }
        if (mixins) {
          mixins.forEach(
            (m) => mergeOptions(to, m, strats, true)
          );
        }
        for (const key in from) {
          if (asMixin && key === "expose") ;
          else {
            const strat = internalOptionMergeStrats[key] || strats && strats[key];
            to[key] = strat ? strat(to[key], from[key]) : from[key];
          }
        }
        return to;
      }
      var internalOptionMergeStrats = {
        data: mergeDataFn,
        props: mergeEmitsOrPropsOptions,
        emits: mergeEmitsOrPropsOptions,
        // objects
        methods: mergeObjectOptions,
        computed: mergeObjectOptions,
        // lifecycle
        beforeCreate: mergeAsArray,
        created: mergeAsArray,
        beforeMount: mergeAsArray,
        mounted: mergeAsArray,
        beforeUpdate: mergeAsArray,
        updated: mergeAsArray,
        beforeDestroy: mergeAsArray,
        beforeUnmount: mergeAsArray,
        destroyed: mergeAsArray,
        unmounted: mergeAsArray,
        activated: mergeAsArray,
        deactivated: mergeAsArray,
        errorCaptured: mergeAsArray,
        serverPrefetch: mergeAsArray,
        // assets
        components: mergeObjectOptions,
        directives: mergeObjectOptions,
        // watch
        watch: mergeWatchOptions,
        // provide / inject
        provide: mergeDataFn,
        inject: mergeInject
      };
      function mergeDataFn(to, from) {
        if (!from) {
          return to;
        }
        if (!to) {
          return from;
        }
        return function mergedDataFn() {
          return shared.extend(
            shared.isFunction(to) ? to.call(this, this) : to,
            shared.isFunction(from) ? from.call(this, this) : from
          );
        };
      }
      function mergeInject(to, from) {
        return mergeObjectOptions(normalizeInject(to), normalizeInject(from));
      }
      function normalizeInject(raw) {
        if (shared.isArray(raw)) {
          const res = {};
          for (let i = 0; i < raw.length; i++) {
            res[raw[i]] = raw[i];
          }
          return res;
        }
        return raw;
      }
      function mergeAsArray(to, from) {
        return to ? [...new Set([].concat(to, from))] : from;
      }
      function mergeObjectOptions(to, from) {
        return to ? shared.extend(/* @__PURE__ */ Object.create(null), to, from) : from;
      }
      function mergeEmitsOrPropsOptions(to, from) {
        if (to) {
          if (shared.isArray(to) && shared.isArray(from)) {
            return [.../* @__PURE__ */ new Set([...to, ...from])];
          }
          return shared.extend(
            /* @__PURE__ */ Object.create(null),
            normalizePropsOrEmits(to),
            normalizePropsOrEmits(from != null ? from : {})
          );
        } else {
          return from;
        }
      }
      function mergeWatchOptions(to, from) {
        if (!to) return from;
        if (!from) return to;
        const merged = shared.extend(/* @__PURE__ */ Object.create(null), to);
        for (const key in from) {
          merged[key] = mergeAsArray(to[key], from[key]);
        }
        return merged;
      }
      function createAppContext() {
        return {
          app: null,
          config: {
            isNativeTag: shared.NO,
            performance: false,
            globalProperties: {},
            optionMergeStrategies: {},
            errorHandler: void 0,
            warnHandler: void 0,
            compilerOptions: {}
          },
          mixins: [],
          components: {},
          directives: {},
          provides: /* @__PURE__ */ Object.create(null),
          optionsCache: /* @__PURE__ */ new WeakMap(),
          propsCache: /* @__PURE__ */ new WeakMap(),
          emitsCache: /* @__PURE__ */ new WeakMap()
        };
      }
      var uid$1 = 0;
      function createAppAPI(render2, hydrate) {
        return function createApp(rootComponent, rootProps = null) {
          if (!shared.isFunction(rootComponent)) {
            rootComponent = shared.extend({}, rootComponent);
          }
          if (rootProps != null && !shared.isObject(rootProps)) {
            rootProps = null;
          }
          const context = createAppContext();
          const installedPlugins = /* @__PURE__ */ new WeakSet();
          const pluginCleanupFns = [];
          let isMounted = false;
          const app = context.app = {
            _uid: uid$1++,
            _component: rootComponent,
            _props: rootProps,
            _container: null,
            _context: context,
            _instance: null,
            version,
            get config() {
              return context.config;
            },
            set config(v) {
            },
            use(plugin, ...options) {
              if (installedPlugins.has(plugin)) ;
              else if (plugin && shared.isFunction(plugin.install)) {
                installedPlugins.add(plugin);
                plugin.install(app, ...options);
              } else if (shared.isFunction(plugin)) {
                installedPlugins.add(plugin);
                plugin(app, ...options);
              } else ;
              return app;
            },
            mixin(mixin) {
              {
                if (!context.mixins.includes(mixin)) {
                  context.mixins.push(mixin);
                }
              }
              return app;
            },
            component(name, component) {
              if (!component) {
                return context.components[name];
              }
              context.components[name] = component;
              return app;
            },
            directive(name, directive) {
              if (!directive) {
                return context.directives[name];
              }
              context.directives[name] = directive;
              return app;
            },
            mount(rootContainer, isHydrate, namespace) {
              if (!isMounted) {
                const vnode = app._ceVNode || createVNode(rootComponent, rootProps);
                vnode.appContext = context;
                if (namespace === true) {
                  namespace = "svg";
                } else if (namespace === false) {
                  namespace = void 0;
                }
                if (isHydrate && hydrate) {
                  hydrate(vnode, rootContainer);
                } else {
                  render2(vnode, rootContainer, namespace);
                }
                isMounted = true;
                app._container = rootContainer;
                rootContainer.__vue_app__ = app;
                return getComponentPublicInstance(vnode.component);
              }
            },
            onUnmount(cleanupFn) {
              pluginCleanupFns.push(cleanupFn);
            },
            unmount() {
              if (isMounted) {
                callWithAsyncErrorHandling(
                  pluginCleanupFns,
                  app._instance,
                  16
                );
                render2(null, app._container);
                delete app._container.__vue_app__;
              }
            },
            provide(key, value) {
              context.provides[key] = value;
              return app;
            },
            runWithContext(fn) {
              const lastApp = currentApp;
              currentApp = app;
              try {
                return fn();
              } finally {
                currentApp = lastApp;
              }
            }
          };
          return app;
        };
      }
      var currentApp = null;
      function useModel(props, name, options = shared.EMPTY_OBJ) {
        const i = getCurrentInstance2();
        const camelizedName = shared.camelize(name);
        const hyphenatedName = shared.hyphenate(name);
        const modifiers = getModelModifiers(props, camelizedName);
        const res = reactivity.customRef((track, trigger) => {
          let localValue;
          let prevSetValue = shared.EMPTY_OBJ;
          let prevEmittedValue;
          watchSyncEffect(() => {
            const propValue = props[camelizedName];
            if (shared.hasChanged(localValue, propValue)) {
              localValue = propValue;
              trigger();
            }
          });
          return {
            get() {
              track();
              return options.get ? options.get(localValue) : localValue;
            },
            set(value) {
              const emittedValue = options.set ? options.set(value) : value;
              if (!shared.hasChanged(emittedValue, localValue) && !(prevSetValue !== shared.EMPTY_OBJ && shared.hasChanged(value, prevSetValue))) {
                return;
              }
              const rawProps = i.vnode.props;
              const hasVModel = !!(rawProps && // check if parent has passed v-model
              (name in rawProps || camelizedName in rawProps || hyphenatedName in rawProps) && (`onUpdate:${name}` in rawProps || `onUpdate:${camelizedName}` in rawProps || `onUpdate:${hyphenatedName}` in rawProps));
              if (!hasVModel) {
                localValue = value;
                trigger();
              }
              i.emit(`update:${name}`, emittedValue);
              if (shared.hasChanged(value, prevSetValue) && (shared.hasChanged(value, emittedValue) && !shared.hasChanged(emittedValue, prevEmittedValue) || // #13524: browsers differ in when they flush microtasks between
              // event listeners. If a v-model listener emits an intermediate value
              // and a following listener restores the model to its previous prop
              // value before parent updates are flushed, the parent render can be
              // deduped as having no prop change. Force a local update so DOM state
              // such as an input's value is synchronized back to the current model.
              hasVModel && prevSetValue !== shared.EMPTY_OBJ && !shared.hasChanged(emittedValue, localValue))) {
                trigger();
              }
              prevSetValue = value;
              prevEmittedValue = emittedValue;
            }
          };
        });
        res[Symbol.iterator] = () => {
          let i2 = 0;
          return {
            next() {
              if (i2 < 2) {
                return { value: i2++ ? modifiers || shared.EMPTY_OBJ : res, done: false };
              } else {
                return { done: true };
              }
            }
          };
        };
        return res;
      }
      var getModelModifiers = (props, modelName) => {
        return modelName === "modelValue" || modelName === "model-value" ? props.modelModifiers : props[`${modelName}Modifiers`] || props[`${shared.camelize(modelName)}Modifiers`] || props[`${shared.hyphenate(modelName)}Modifiers`];
      };
      function emit(instance, event, ...rawArgs) {
        if (instance.isUnmounted) return;
        const props = instance.vnode.props || shared.EMPTY_OBJ;
        let args = rawArgs;
        const isModelListener = event.startsWith("update:");
        const modifiers = isModelListener && getModelModifiers(props, event.slice(7));
        if (modifiers) {
          if (modifiers.trim) {
            args = rawArgs.map((a) => shared.isString(a) ? a.trim() : a);
          }
          if (modifiers.number) {
            args = args.map(shared.looseToNumber);
          }
        }
        let handlerName;
        let handler = props[handlerName = shared.toHandlerKey(event)] || // also try camelCase event handler (#2249)
        props[handlerName = shared.toHandlerKey(shared.camelize(event))];
        if (!handler && isModelListener) {
          handler = props[handlerName = shared.toHandlerKey(shared.hyphenate(event))];
        }
        if (handler) {
          callWithAsyncErrorHandling(
            handler,
            instance,
            6,
            args
          );
        }
        const onceHandler = props[handlerName + `Once`];
        if (onceHandler) {
          if (!instance.emitted) {
            instance.emitted = {};
          } else if (instance.emitted[handlerName]) {
            return;
          }
          instance.emitted[handlerName] = true;
          callWithAsyncErrorHandling(
            onceHandler,
            instance,
            6,
            args
          );
        }
      }
      var mixinEmitsCache = /* @__PURE__ */ new WeakMap();
      function normalizeEmitsOptions(comp, appContext, asMixin = false) {
        const cache = asMixin ? mixinEmitsCache : appContext.emitsCache;
        const cached = cache.get(comp);
        if (cached !== void 0) {
          return cached;
        }
        const raw = comp.emits;
        let normalized = {};
        let hasExtends = false;
        if (!shared.isFunction(comp)) {
          const extendEmits = (raw2) => {
            const normalizedFromExtend = normalizeEmitsOptions(raw2, appContext, true);
            if (normalizedFromExtend) {
              hasExtends = true;
              shared.extend(normalized, normalizedFromExtend);
            }
          };
          if (!asMixin && appContext.mixins.length) {
            appContext.mixins.forEach(extendEmits);
          }
          if (comp.extends) {
            extendEmits(comp.extends);
          }
          if (comp.mixins) {
            comp.mixins.forEach(extendEmits);
          }
        }
        if (!raw && !hasExtends) {
          if (shared.isObject(comp)) {
            cache.set(comp, null);
          }
          return null;
        }
        if (shared.isArray(raw)) {
          raw.forEach((key) => normalized[key] = null);
        } else {
          shared.extend(normalized, raw);
        }
        if (shared.isObject(comp)) {
          cache.set(comp, normalized);
        }
        return normalized;
      }
      function isEmitListener(options, key) {
        if (!options || !shared.isOn(key)) {
          return false;
        }
        key = key.slice(2);
        key = key === "Once" ? key : key.replace(/Once$/, "");
        return shared.hasOwn(options, key[0].toLowerCase() + key.slice(1)) || shared.hasOwn(options, shared.hyphenate(key)) || shared.hasOwn(options, key);
      }
      function renderComponentRoot(instance) {
        const {
          type: Component,
          vnode,
          proxy,
          withProxy,
          propsOptions: [propsOptions],
          slots,
          attrs,
          emit: emit2,
          render: render2,
          renderCache,
          props,
          data,
          setupState,
          ctx,
          inheritAttrs
        } = instance;
        const prev = setCurrentRenderingInstance(instance);
        let result;
        let fallthroughAttrs;
        try {
          if (vnode.shapeFlag & 4) {
            const proxyToUse = withProxy || proxy;
            const thisProxy = false ? new Proxy(proxyToUse, {
              get(target, key, receiver) {
                warn(
                  `Property '${String(
                    key
                  )}' was accessed via 'this'. Avoid using 'this' in templates.`
                );
                return Reflect.get(target, key, receiver);
              }
            }) : proxyToUse;
            result = normalizeVNode(
              render2.call(
                thisProxy,
                proxyToUse,
                renderCache,
                false ? shallowReadonly(props) : props,
                setupState,
                data,
                ctx
              )
            );
            fallthroughAttrs = attrs;
          } else {
            const render22 = Component;
            if (false) ;
            result = normalizeVNode(
              render22.length > 1 ? render22(
                false ? shallowReadonly(props) : props,
                false ? {
                  get attrs() {
                    markAttrsAccessed();
                    return shallowReadonly(attrs);
                  },
                  slots,
                  emit: emit2
                } : { attrs, slots, emit: emit2 }
              ) : render22(
                false ? shallowReadonly(props) : props,
                null
              )
            );
            fallthroughAttrs = Component.props ? attrs : getFunctionalFallthrough(attrs);
          }
        } catch (err) {
          blockStack.length = 0;
          handleError(err, instance, 1);
          result = createVNode(Comment);
        }
        let root = result;
        if (fallthroughAttrs && inheritAttrs !== false) {
          const keys = Object.keys(fallthroughAttrs);
          const { shapeFlag } = root;
          if (keys.length) {
            if (shapeFlag & (1 | 6)) {
              if (propsOptions && keys.some(shared.isModelListener)) {
                fallthroughAttrs = filterModelListeners(
                  fallthroughAttrs,
                  propsOptions
                );
              }
              root = cloneVNode(root, fallthroughAttrs, false, true);
            }
          }
        }
        if (vnode.dirs) {
          root = cloneVNode(root, null, false, true);
          root.dirs = root.dirs ? root.dirs.concat(vnode.dirs) : vnode.dirs;
        }
        if (vnode.transition) {
          const child = isTeleport(root.type) ? getInnerChild$1(root) || root : root;
          setTransitionHooks(child, vnode.transition);
        }
        {
          result = root;
        }
        setCurrentRenderingInstance(prev);
        return result;
      }
      function filterSingleRoot(children, recurse = true) {
        let singleRoot;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (isVNode(child)) {
            if (child.type !== Comment || child.children === "v-if") {
              if (singleRoot) {
                return;
              } else {
                singleRoot = child;
              }
            }
          } else {
            return;
          }
        }
        return singleRoot;
      }
      var getFunctionalFallthrough = (attrs) => {
        let res;
        for (const key in attrs) {
          if (key === "class" || key === "style" || shared.isOn(key)) {
            (res || (res = {}))[key] = attrs[key];
          }
        }
        return res;
      };
      var filterModelListeners = (attrs, props) => {
        const res = {};
        for (const key in attrs) {
          if (!shared.isModelListener(key) || !(key.slice(9) in props)) {
            res[key] = attrs[key];
          }
        }
        return res;
      };
      function shouldUpdateComponent(prevVNode, nextVNode, optimized) {
        const { props: prevProps, children: prevChildren, component } = prevVNode;
        const { props: nextProps, children: nextChildren, patchFlag } = nextVNode;
        const emits = component.emitsOptions;
        if (nextVNode.dirs || nextVNode.transition) {
          return true;
        }
        if (optimized && patchFlag >= 0) {
          if (patchFlag & 1024) {
            return true;
          }
          if (patchFlag & 16) {
            if (!prevProps) {
              return !!nextProps;
            }
            return hasPropsChanged(prevProps, nextProps, emits);
          } else if (patchFlag & 8) {
            const dynamicProps = nextVNode.dynamicProps;
            for (let i = 0; i < dynamicProps.length; i++) {
              const key = dynamicProps[i];
              if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emits, key)) {
                return true;
              }
            }
          }
        } else {
          if (prevChildren || nextChildren) {
            if (!nextChildren || !nextChildren.$stable) {
              return true;
            }
          }
          if (prevProps === nextProps) {
            return false;
          }
          if (!prevProps) {
            return !!nextProps;
          }
          if (!nextProps) {
            return true;
          }
          return hasPropsChanged(prevProps, nextProps, emits);
        }
        return false;
      }
      function hasPropsChanged(prevProps, nextProps, emitsOptions) {
        const nextKeys = Object.keys(nextProps);
        if (nextKeys.length !== Object.keys(prevProps).length) {
          return true;
        }
        for (let i = 0; i < nextKeys.length; i++) {
          const key = nextKeys[i];
          if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emitsOptions, key)) {
            return true;
          }
        }
        return false;
      }
      function hasPropValueChanged(nextProps, prevProps, key) {
        const nextProp = nextProps[key];
        const prevProp = prevProps[key];
        if (key === "style" && shared.isObject(nextProp) && shared.isObject(prevProp)) {
          return !shared.looseEqual(nextProp, prevProp);
        }
        return nextProp !== prevProp;
      }
      function updateHOCHostEl({ vnode, parent, suspense }, el) {
        while (parent) {
          const root = parent.subTree;
          if (root.suspense && root.suspense.activeBranch === vnode) {
            root.suspense.vnode.el = root.el = el;
            vnode = root;
          }
          if (root === vnode) {
            (vnode = parent.vnode).el = el;
            parent = parent.parent;
          } else {
            break;
          }
        }
        if (suspense && suspense.activeBranch === vnode) {
          suspense.vnode.el = el;
        }
      }
      var internalObjectProto = {};
      var createInternalObject = () => Object.create(internalObjectProto);
      var isInternalObject = (obj) => Object.getPrototypeOf(obj) === internalObjectProto;
      function initProps(instance, rawProps, isStateful, isSSR = false) {
        const props = {};
        const attrs = createInternalObject();
        instance.propsDefaults = /* @__PURE__ */ Object.create(null);
        setFullProps(instance, rawProps, props, attrs);
        for (const key in instance.propsOptions[0]) {
          if (!(key in props)) {
            props[key] = void 0;
          }
        }
        if (isStateful) {
          instance.props = isSSR ? props : reactivity.shallowReactive(props);
        } else {
          if (!instance.type.props) {
            instance.props = attrs;
          } else {
            instance.props = props;
          }
        }
        instance.attrs = attrs;
      }
      function updateProps(instance, rawProps, rawPrevProps, optimized) {
        const {
          props,
          attrs,
          vnode: { patchFlag }
        } = instance;
        const rawCurrentProps = reactivity.toRaw(props);
        const [options] = instance.propsOptions;
        let hasAttrsChanged = false;
        if (
          // always force full diff in dev
          // - #1942 if hmr is enabled with sfc component
          // - vite#872 non-sfc component used by sfc component
          (optimized || patchFlag > 0) && !(patchFlag & 16)
        ) {
          if (patchFlag & 8) {
            const propsToUpdate = instance.vnode.dynamicProps;
            for (let i = 0; i < propsToUpdate.length; i++) {
              let key = propsToUpdate[i];
              if (isEmitListener(instance.emitsOptions, key)) {
                continue;
              }
              const value = rawProps[key];
              if (options) {
                if (shared.hasOwn(attrs, key)) {
                  if (value !== attrs[key]) {
                    attrs[key] = value;
                    hasAttrsChanged = true;
                  }
                } else {
                  const camelizedKey = shared.camelize(key);
                  props[camelizedKey] = resolvePropValue(
                    options,
                    rawCurrentProps,
                    camelizedKey,
                    value,
                    instance,
                    false
                  );
                }
              } else {
                if (value !== attrs[key]) {
                  attrs[key] = value;
                  hasAttrsChanged = true;
                }
              }
            }
          }
        } else {
          if (setFullProps(instance, rawProps, props, attrs)) {
            hasAttrsChanged = true;
          }
          let kebabKey;
          for (const key in rawCurrentProps) {
            if (!rawProps || // for camelCase
            !shared.hasOwn(rawProps, key) && // it's possible the original props was passed in as kebab-case
            // and converted to camelCase (#955)
            ((kebabKey = shared.hyphenate(key)) === key || !shared.hasOwn(rawProps, kebabKey))) {
              if (options) {
                if (rawPrevProps && // for camelCase
                (rawPrevProps[key] !== void 0 || // for kebab-case
                rawPrevProps[kebabKey] !== void 0)) {
                  props[key] = resolvePropValue(
                    options,
                    rawCurrentProps,
                    key,
                    void 0,
                    instance,
                    true
                  );
                }
              } else {
                delete props[key];
              }
            }
          }
          if (attrs !== rawCurrentProps) {
            for (const key in attrs) {
              if (!rawProps || !shared.hasOwn(rawProps, key) && true) {
                delete attrs[key];
                hasAttrsChanged = true;
              }
            }
          }
        }
        if (hasAttrsChanged) {
          reactivity.trigger(instance.attrs, "set", "");
        }
      }
      function setFullProps(instance, rawProps, props, attrs) {
        const [options, needCastKeys] = instance.propsOptions;
        let hasAttrsChanged = false;
        let rawCastValues;
        if (rawProps) {
          for (let key in rawProps) {
            if (shared.isReservedProp(key)) {
              continue;
            }
            const value = rawProps[key];
            let camelKey;
            if (options && shared.hasOwn(options, camelKey = shared.camelize(key))) {
              if (!needCastKeys || !needCastKeys.includes(camelKey)) {
                props[camelKey] = value;
              } else {
                (rawCastValues || (rawCastValues = {}))[camelKey] = value;
              }
            } else if (!isEmitListener(instance.emitsOptions, key)) {
              if (!(key in attrs) || value !== attrs[key]) {
                attrs[key] = value;
                hasAttrsChanged = true;
              }
            }
          }
        }
        if (needCastKeys) {
          const rawCurrentProps = reactivity.toRaw(props);
          const castValues = rawCastValues || shared.EMPTY_OBJ;
          for (let i = 0; i < needCastKeys.length; i++) {
            const key = needCastKeys[i];
            props[key] = resolvePropValue(
              options,
              rawCurrentProps,
              key,
              castValues[key],
              instance,
              !shared.hasOwn(castValues, key)
            );
          }
        }
        return hasAttrsChanged;
      }
      function resolvePropValue(options, props, key, value, instance, isAbsent) {
        const opt = options[key];
        if (opt != null) {
          const hasDefault = shared.hasOwn(opt, "default");
          if (hasDefault && value === void 0) {
            const defaultValue = opt.default;
            if (opt.type !== Function && !opt.skipFactory && shared.isFunction(defaultValue)) {
              const { propsDefaults } = instance;
              if (key in propsDefaults) {
                value = propsDefaults[key];
              } else {
                const reset = setCurrentInstance(instance);
                value = propsDefaults[key] = defaultValue.call(
                  null,
                  props
                );
                reset();
              }
            } else {
              value = defaultValue;
            }
            if (instance.ce) {
              instance.ce._setProp(key, value);
            }
          }
          if (opt[
            0
            /* shouldCast */
          ]) {
            if (isAbsent && !hasDefault) {
              value = false;
            } else if (opt[
              1
              /* shouldCastTrue */
            ] && (value === "" || value === shared.hyphenate(key))) {
              value = true;
            }
          }
        }
        return value;
      }
      var mixinPropsCache = /* @__PURE__ */ new WeakMap();
      function normalizePropsOptions(comp, appContext, asMixin = false) {
        const cache = asMixin ? mixinPropsCache : appContext.propsCache;
        const cached = cache.get(comp);
        if (cached) {
          return cached;
        }
        const raw = comp.props;
        const normalized = {};
        const needCastKeys = [];
        let hasExtends = false;
        if (!shared.isFunction(comp)) {
          const extendProps = (raw2) => {
            hasExtends = true;
            const [props, keys] = normalizePropsOptions(raw2, appContext, true);
            shared.extend(normalized, props);
            if (keys) needCastKeys.push(...keys);
          };
          if (!asMixin && appContext.mixins.length) {
            appContext.mixins.forEach(extendProps);
          }
          if (comp.extends) {
            extendProps(comp.extends);
          }
          if (comp.mixins) {
            comp.mixins.forEach(extendProps);
          }
        }
        if (!raw && !hasExtends) {
          if (shared.isObject(comp)) {
            cache.set(comp, shared.EMPTY_ARR);
          }
          return shared.EMPTY_ARR;
        }
        if (shared.isArray(raw)) {
          for (let i = 0; i < raw.length; i++) {
            const normalizedKey = shared.camelize(raw[i]);
            if (validatePropName(normalizedKey)) {
              normalized[normalizedKey] = shared.EMPTY_OBJ;
            }
          }
        } else if (raw) {
          for (const key in raw) {
            const normalizedKey = shared.camelize(key);
            if (validatePropName(normalizedKey)) {
              const opt = raw[key];
              const prop = normalized[normalizedKey] = shared.isArray(opt) || shared.isFunction(opt) ? { type: opt } : shared.extend({}, opt);
              const propType = prop.type;
              let shouldCast = false;
              let shouldCastTrue = true;
              if (shared.isArray(propType)) {
                for (let index = 0; index < propType.length; ++index) {
                  const type = propType[index];
                  const typeName = shared.isFunction(type) && type.name;
                  if (typeName === "Boolean") {
                    shouldCast = true;
                    break;
                  } else if (typeName === "String") {
                    shouldCastTrue = false;
                  }
                }
              } else {
                shouldCast = shared.isFunction(propType) && propType.name === "Boolean";
              }
              prop[
                0
                /* shouldCast */
              ] = shouldCast;
              prop[
                1
                /* shouldCastTrue */
              ] = shouldCastTrue;
              if (shouldCast || shared.hasOwn(prop, "default")) {
                needCastKeys.push(normalizedKey);
              }
            }
          }
        }
        const res = [normalized, needCastKeys];
        if (shared.isObject(comp)) {
          cache.set(comp, res);
        }
        return res;
      }
      function validatePropName(key) {
        if (key[0] !== "$" && !shared.isReservedProp(key)) {
          return true;
        }
        return false;
      }
      var isInternalKey = (key) => key === "_" || key === "_ctx" || key === "$stable";
      var normalizeSlotValue = (value) => shared.isArray(value) ? value.map(normalizeVNode) : [normalizeVNode(value)];
      var normalizeSlot = (key, rawSlot, ctx) => {
        if (rawSlot._n) {
          return rawSlot;
        }
        const normalized = withCtx((...args) => {
          if (false) ;
          return normalizeSlotValue(rawSlot(...args));
        }, ctx);
        normalized._c = false;
        return normalized;
      };
      var normalizeObjectSlots = (rawSlots, slots, instance) => {
        const ctx = rawSlots._ctx;
        for (const key in rawSlots) {
          if (isInternalKey(key)) continue;
          const value = rawSlots[key];
          if (shared.isFunction(value)) {
            slots[key] = normalizeSlot(key, value, ctx);
          } else if (value != null) {
            const normalized = normalizeSlotValue(value);
            slots[key] = () => normalized;
          }
        }
      };
      var normalizeVNodeSlots = (instance, children) => {
        const normalized = normalizeSlotValue(children);
        instance.slots.default = () => normalized;
      };
      var assignSlots = (slots, children, optimized) => {
        for (const key in children) {
          if (optimized || !isInternalKey(key)) {
            slots[key] = children[key];
          }
        }
      };
      var initSlots = (instance, children, optimized) => {
        const slots = instance.slots = createInternalObject();
        if (instance.vnode.shapeFlag & 32) {
          const type = children._;
          if (type) {
            assignSlots(slots, children, optimized);
            if (optimized) {
              shared.def(slots, "_", type, true);
            }
          } else {
            normalizeObjectSlots(children, slots);
          }
        } else if (children) {
          normalizeVNodeSlots(instance, children);
        }
      };
      var updateSlots = (instance, children, optimized) => {
        const { vnode, slots } = instance;
        let needDeletionCheck = true;
        let deletionComparisonTarget = shared.EMPTY_OBJ;
        if (vnode.shapeFlag & 32) {
          const type = children._;
          if (type) {
            if (optimized && type === 1) {
              needDeletionCheck = false;
            } else {
              assignSlots(slots, children, optimized);
            }
          } else {
            needDeletionCheck = !children.$stable;
            normalizeObjectSlots(children, slots);
          }
          deletionComparisonTarget = children;
        } else if (children) {
          normalizeVNodeSlots(instance, children);
          deletionComparisonTarget = { default: 1 };
        }
        if (needDeletionCheck) {
          for (const key in slots) {
            if (!isInternalKey(key) && deletionComparisonTarget[key] == null) {
              delete slots[key];
            }
          }
        }
      };
      var queuePostRenderEffect = queueEffectWithSuspense;
      function createRenderer2(options) {
        return baseCreateRenderer(options);
      }
      function createHydrationRenderer(options) {
        return baseCreateRenderer(options, createHydrationFunctions);
      }
      function baseCreateRenderer(options, createHydrationFns) {
        const target = shared.getGlobalThis();
        target.__VUE__ = true;
        const {
          insert: hostInsert,
          remove: hostRemove,
          patchProp: hostPatchProp,
          createElement: hostCreateElement,
          createText: hostCreateText,
          createComment: hostCreateComment,
          setText: hostSetText,
          setElementText: hostSetElementText,
          parentNode: hostParentNode,
          nextSibling: hostNextSibling,
          setScopeId: hostSetScopeId = shared.NOOP,
          insertStaticContent: hostInsertStaticContent
        } = options;
        const patch = (n1, n2, container, anchor = null, parentComponent = null, parentSuspense = null, namespace = void 0, slotScopeIds = null, optimized = !!n2.dynamicChildren) => {
          if (n1 === n2) {
            return;
          }
          if (n1 && !isSameVNodeType(n1, n2)) {
            anchor = getNextHostNode(n1);
            unmount(n1, parentComponent, parentSuspense, true);
            n1 = null;
          }
          if (n2.patchFlag === -2) {
            optimized = false;
            n2.dynamicChildren = null;
          }
          const { type, ref: ref2, shapeFlag } = n2;
          switch (type) {
            case Text:
              processText(n1, n2, container, anchor);
              break;
            case Comment:
              processCommentNode(n1, n2, container, anchor);
              break;
            case Static:
              if (n1 == null) {
                mountStaticNode(n2, container, anchor, namespace);
              }
              break;
            case Fragment:
              processFragment(
                n1,
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              break;
            default:
              if (shapeFlag & 1) {
                processElement(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (shapeFlag & 6) {
                processComponent(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (shapeFlag & 64) {
                type.process(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized,
                  internals
                );
              } else if (shapeFlag & 128) {
                type.process(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized,
                  internals
                );
              } else ;
          }
          if (ref2 != null && parentComponent) {
            setRef(ref2, n1 && n1.ref, parentSuspense, n2 || n1, !n2);
          } else if (ref2 == null && n1 && n1.ref != null) {
            setRef(n1.ref, null, parentSuspense, n1, true);
          }
        };
        const processText = (n1, n2, container, anchor) => {
          if (n1 == null) {
            hostInsert(
              n2.el = hostCreateText(n2.children),
              container,
              anchor
            );
          } else {
            const el = n2.el = n1.el;
            if (n2.children !== n1.children) {
              hostSetText(el, n2.children);
            }
          }
        };
        const processCommentNode = (n1, n2, container, anchor) => {
          if (n1 == null) {
            hostInsert(
              n2.el = hostCreateComment(n2.children || ""),
              container,
              anchor
            );
          } else {
            n2.el = n1.el;
          }
        };
        const mountStaticNode = (n2, container, anchor, namespace) => {
          [n2.el, n2.anchor] = hostInsertStaticContent(
            n2.children,
            container,
            anchor,
            namespace,
            n2.el,
            n2.anchor
          );
        };
        const moveStaticNode = ({ el, anchor }, container, nextSibling) => {
          let next;
          while (el && el !== anchor) {
            next = hostNextSibling(el);
            hostInsert(el, container, nextSibling);
            el = next;
          }
          hostInsert(anchor, container, nextSibling);
        };
        const removeStaticNode = ({ el, anchor }) => {
          let next;
          while (el && el !== anchor) {
            next = hostNextSibling(el);
            hostRemove(el);
            el = next;
          }
          hostRemove(anchor);
        };
        const processElement = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          if (n2.type === "svg") {
            namespace = "svg";
          } else if (n2.type === "math") {
            namespace = "mathml";
          }
          if (n1 == null) {
            mountElement(
              n2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          } else {
            const customElement = n1.el && n1.el._isVueCE ? n1.el : null;
            try {
              if (customElement) {
                customElement._beginPatch();
              }
              patchElement(
                n1,
                n2,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } finally {
              if (customElement) {
                customElement._endPatch();
              }
            }
          }
        };
        const mountElement = (vnode, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          let el;
          let vnodeHook;
          const { props, shapeFlag, transition, dirs } = vnode;
          el = vnode.el = hostCreateElement(
            vnode.type,
            namespace,
            props && props.is,
            props
          );
          if (shapeFlag & 8) {
            hostSetElementText(el, vnode.children);
          } else if (shapeFlag & 16) {
            mountChildren(
              vnode.children,
              el,
              null,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(vnode, namespace),
              slotScopeIds,
              optimized
            );
          }
          if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, "created");
          }
          setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent);
          if (props) {
            for (const key in props) {
              if (key !== "value" && !shared.isReservedProp(key)) {
                hostPatchProp(el, key, null, props[key], namespace, parentComponent);
              }
            }
            if ("value" in props) {
              hostPatchProp(el, "value", null, props.value, namespace);
            }
            if (vnodeHook = props.onVnodeBeforeMount) {
              invokeVNodeHook(vnodeHook, parentComponent, vnode);
            }
          }
          if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
          }
          const needCallTransitionHooks = needTransition(parentSuspense, transition);
          if (needCallTransitionHooks) {
            transition.beforeEnter(el);
          }
          hostInsert(el, container, anchor);
          if ((vnodeHook = props && props.onVnodeMounted) || needCallTransitionHooks || dirs) {
            queuePostRenderEffect(() => {
              try {
                vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
                needCallTransitionHooks && transition.enter(el);
                dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
              } finally {
              }
            }, parentSuspense);
          }
        };
        const setScopeId = (el, vnode, scopeId, slotScopeIds, parentComponent) => {
          if (scopeId) {
            hostSetScopeId(el, scopeId);
          }
          if (slotScopeIds) {
            for (let i = 0; i < slotScopeIds.length; i++) {
              hostSetScopeId(el, slotScopeIds[i]);
            }
          }
          if (parentComponent) {
            let subTree = parentComponent.subTree;
            if (vnode === subTree || isSuspense(subTree.type) && (subTree.ssContent === vnode || subTree.ssFallback === vnode)) {
              const parentVNode = parentComponent.vnode;
              setScopeId(
                el,
                parentVNode,
                parentVNode.scopeId,
                parentVNode.slotScopeIds,
                parentComponent.parent
              );
            }
          }
        };
        const mountChildren = (children, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, start = 0) => {
          for (let i = start; i < children.length; i++) {
            const child = children[i] = optimized ? cloneIfMounted(children[i]) : normalizeVNode(children[i]);
            patch(
              null,
              child,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          }
        };
        const patchElement = (n1, n2, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          const el = n2.el = n1.el;
          let { patchFlag, dynamicChildren, dirs } = n2;
          patchFlag |= n1.patchFlag & 16;
          const oldProps = n1.props || shared.EMPTY_OBJ;
          const newProps = n2.props || shared.EMPTY_OBJ;
          let vnodeHook;
          parentComponent && toggleRecurse(parentComponent, false);
          if (vnodeHook = newProps.onVnodeBeforeUpdate) {
            invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
          }
          if (dirs) {
            invokeDirectiveHook(n2, n1, parentComponent, "beforeUpdate");
          }
          parentComponent && toggleRecurse(parentComponent, true);
          if (
            // #6385 the old vnode may be a user-wrapped non-isomorphic block
            // Force full diff when block metadata is unstable.
            dynamicChildren && (!n1.dynamicChildren || n1.dynamicChildren.length !== dynamicChildren.length)
          ) {
            patchFlag = 0;
            optimized = false;
            dynamicChildren = null;
          }
          if (oldProps.innerHTML && newProps.innerHTML == null || oldProps.textContent && newProps.textContent == null) {
            hostSetElementText(el, "");
          }
          if (dynamicChildren) {
            patchBlockChildren(
              n1.dynamicChildren,
              dynamicChildren,
              el,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(n2, namespace),
              slotScopeIds
            );
          } else if (!optimized) {
            patchChildren(
              n1,
              n2,
              el,
              null,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(n2, namespace),
              slotScopeIds,
              false
            );
          }
          if (patchFlag > 0) {
            if (patchFlag & 16) {
              patchProps(el, oldProps, newProps, parentComponent, namespace);
            } else {
              if (patchFlag & 2) {
                if (oldProps.class !== newProps.class) {
                  hostPatchProp(el, "class", null, newProps.class, namespace);
                }
              }
              if (patchFlag & 4) {
                hostPatchProp(el, "style", oldProps.style, newProps.style, namespace);
              }
              if (patchFlag & 8) {
                const propsToUpdate = n2.dynamicProps;
                for (let i = 0; i < propsToUpdate.length; i++) {
                  const key = propsToUpdate[i];
                  const prev = oldProps[key];
                  const next = newProps[key];
                  if (next !== prev || key === "value") {
                    hostPatchProp(el, key, prev, next, namespace, parentComponent);
                  }
                }
              }
            }
            if (patchFlag & 1) {
              if (n1.children !== n2.children) {
                hostSetElementText(el, n2.children);
              }
            }
          } else if (!optimized && dynamicChildren == null) {
            patchProps(el, oldProps, newProps, parentComponent, namespace);
          }
          if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
            queuePostRenderEffect(() => {
              vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
              dirs && invokeDirectiveHook(n2, n1, parentComponent, "updated");
            }, parentSuspense);
          }
        };
        const patchBlockChildren = (oldChildren, newChildren, fallbackContainer, parentComponent, parentSuspense, namespace, slotScopeIds) => {
          for (let i = 0; i < newChildren.length; i++) {
            const oldVNode = oldChildren[i];
            const newVNode = newChildren[i];
            const container = (
              // oldVNode may be an errored async setup() component inside Suspense
              // which will not have a mounted element
              oldVNode.el && // - In the case of a Fragment, we need to provide the actual parent
              // of the Fragment itself so it can move its children.
              (oldVNode.type === Fragment || // - In the case of different nodes, there is going to be a replacement
              // which also requires the correct parent container
              !isSameVNodeType(oldVNode, newVNode) || // - In the case of a component, it could contain anything.
              oldVNode.shapeFlag & (6 | 64 | 128)) ? hostParentNode(oldVNode.el) : (
                // In other cases, the parent container is not actually used so we
                // just pass the block element here to avoid a DOM parentNode call.
                fallbackContainer
              )
            );
            patch(
              oldVNode,
              newVNode,
              container,
              null,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              true
            );
          }
        };
        const patchProps = (el, oldProps, newProps, parentComponent, namespace) => {
          if (oldProps !== newProps) {
            if (oldProps !== shared.EMPTY_OBJ) {
              for (const key in oldProps) {
                if (!shared.isReservedProp(key) && !(key in newProps)) {
                  hostPatchProp(
                    el,
                    key,
                    oldProps[key],
                    null,
                    namespace,
                    parentComponent
                  );
                }
              }
            }
            for (const key in newProps) {
              if (shared.isReservedProp(key)) continue;
              const next = newProps[key];
              const prev = oldProps[key];
              if (next !== prev && key !== "value") {
                hostPatchProp(el, key, prev, next, namespace, parentComponent);
              }
            }
            if ("value" in newProps) {
              hostPatchProp(el, "value", oldProps.value, newProps.value, namespace);
            }
          }
        };
        const processFragment = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          const fragmentStartAnchor = n2.el = n1 ? n1.el : hostCreateText("");
          const fragmentEndAnchor = n2.anchor = n1 ? n1.anchor : hostCreateText("");
          let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2;
          if (fragmentSlotScopeIds) {
            slotScopeIds = slotScopeIds ? slotScopeIds.concat(fragmentSlotScopeIds) : fragmentSlotScopeIds;
          }
          if (n1 == null) {
            hostInsert(fragmentStartAnchor, container, anchor);
            hostInsert(fragmentEndAnchor, container, anchor);
            mountChildren(
              // #10007
              // such fragment like `<></>` will be compiled into
              // a fragment which doesn't have a children.
              // In this case fallback to an empty array
              n2.children || [],
              container,
              fragmentEndAnchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          } else {
            if (patchFlag > 0 && patchFlag & 64 && dynamicChildren && // #2715 the previous fragment could've been a BAILed one as a result
            // of renderSlot() with no valid children
            n1.dynamicChildren && n1.dynamicChildren.length === dynamicChildren.length) {
              patchBlockChildren(
                n1.dynamicChildren,
                dynamicChildren,
                container,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds
              );
              if (
                // #2080 if the stable fragment has a key, it's a <template v-for> that may
                //  get moved around. Make sure all root level vnodes inherit el.
                // #2134 or if it's a component root, it may also get moved around
                // as the component is being moved.
                n2.key != null || parentComponent && n2 === parentComponent.subTree
              ) {
                traverseStaticChildren(
                  n1,
                  n2,
                  true
                  /* shallow */
                );
              }
            } else {
              patchChildren(
                n1,
                n2,
                container,
                fragmentEndAnchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            }
          }
        };
        const processComponent = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          n2.slotScopeIds = slotScopeIds;
          if (n1 == null) {
            if (n2.shapeFlag & 512) {
              parentComponent.ctx.activate(
                n2,
                container,
                anchor,
                namespace,
                optimized
              );
            } else {
              mountComponent(
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                optimized
              );
            }
          } else {
            updateComponent(n1, n2, optimized);
          }
        };
        const mountComponent = (initialVNode, container, anchor, parentComponent, parentSuspense, namespace, optimized) => {
          const instance = initialVNode.component = createComponentInstance(
            initialVNode,
            parentComponent,
            parentSuspense
          );
          if (isKeepAlive(initialVNode)) {
            instance.ctx.renderer = internals;
          }
          {
            setupComponent(instance, false, optimized);
          }
          if (instance.asyncDep) {
            parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect, optimized);
            if (!initialVNode.el) {
              const placeholder = instance.subTree = createVNode(Comment);
              processCommentNode(null, placeholder, container, anchor);
              initialVNode.placeholder = placeholder.el;
            }
          } else {
            setupRenderEffect(
              instance,
              initialVNode,
              container,
              anchor,
              parentSuspense,
              namespace,
              optimized
            );
          }
        };
        const updateComponent = (n1, n2, optimized) => {
          const instance = n2.component = n1.component;
          if (shouldUpdateComponent(n1, n2, optimized)) {
            if (instance.asyncDep && !instance.asyncResolved) {
              updateComponentPreRender(instance, n2, optimized);
              return;
            } else {
              instance.next = n2;
              instance.update();
            }
          } else {
            n2.el = n1.el;
            instance.vnode = n2;
          }
        };
        const setupRenderEffect = (instance, initialVNode, container, anchor, parentSuspense, namespace, optimized) => {
          const componentUpdateFn = () => {
            if (!instance.isMounted) {
              let vnodeHook;
              const { el, props } = initialVNode;
              const { bm, m, parent, root, type } = instance;
              const isAsyncWrapperVNode = isAsyncWrapper(initialVNode);
              toggleRecurse(instance, false);
              if (bm) {
                shared.invokeArrayFns(bm);
              }
              if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeBeforeMount)) {
                invokeVNodeHook(vnodeHook, parent, initialVNode);
              }
              toggleRecurse(instance, true);
              if (el && hydrateNode) {
                const hydrateSubTree = () => {
                  instance.subTree = renderComponentRoot(instance);
                  hydrateNode(
                    el,
                    instance.subTree,
                    instance,
                    parentSuspense,
                    null
                  );
                };
                if (isAsyncWrapperVNode && type.__asyncHydrate) {
                  type.__asyncHydrate(
                    el,
                    instance,
                    hydrateSubTree
                  );
                } else {
                  hydrateSubTree();
                }
              } else {
                if (root.ce && root.ce._hasShadowRoot()) {
                  root.ce._injectChildStyle(
                    type,
                    instance.parent ? instance.parent.type : void 0
                  );
                }
                const subTree = instance.subTree = renderComponentRoot(instance);
                patch(
                  null,
                  subTree,
                  container,
                  anchor,
                  instance,
                  parentSuspense,
                  namespace
                );
                initialVNode.el = subTree.el;
              }
              if (m) {
                queuePostRenderEffect(m, parentSuspense);
              }
              if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeMounted)) {
                const scopedInitialVNode = initialVNode;
                queuePostRenderEffect(
                  () => invokeVNodeHook(vnodeHook, parent, scopedInitialVNode),
                  parentSuspense
                );
              }
              if (initialVNode.shapeFlag & 256 || parent && isAsyncWrapper(parent.vnode) && parent.vnode.shapeFlag & 256) {
                instance.a && queuePostRenderEffect(instance.a, parentSuspense);
              }
              instance.isMounted = true;
              initialVNode = container = anchor = null;
            } else {
              let { next, bu, u, parent, vnode } = instance;
              {
                const nonHydratedAsyncRoot = locateNonHydratedAsyncRoot(instance);
                if (nonHydratedAsyncRoot) {
                  if (next) {
                    next.el = vnode.el;
                    updateComponentPreRender(instance, next, optimized);
                  }
                  nonHydratedAsyncRoot.asyncDep.then(() => {
                    queuePostRenderEffect(() => {
                      if (!instance.isUnmounted) update();
                    }, parentSuspense);
                  });
                  return;
                }
              }
              let originNext = next;
              let vnodeHook;
              toggleRecurse(instance, false);
              if (next) {
                next.el = vnode.el;
                updateComponentPreRender(instance, next, optimized);
              } else {
                next = vnode;
              }
              if (bu) {
                shared.invokeArrayFns(bu);
              }
              if (vnodeHook = next.props && next.props.onVnodeBeforeUpdate) {
                invokeVNodeHook(vnodeHook, parent, next, vnode);
              }
              toggleRecurse(instance, true);
              const nextTree = renderComponentRoot(instance);
              const prevTree = instance.subTree;
              instance.subTree = nextTree;
              patch(
                prevTree,
                nextTree,
                // parent may have changed if it's in a teleport
                hostParentNode(prevTree.el),
                // anchor may have changed if it's in a fragment
                getNextHostNode(prevTree),
                instance,
                parentSuspense,
                namespace
              );
              next.el = nextTree.el;
              if (originNext === null) {
                updateHOCHostEl(instance, nextTree.el);
              }
              if (u) {
                queuePostRenderEffect(u, parentSuspense);
              }
              if (vnodeHook = next.props && next.props.onVnodeUpdated) {
                queuePostRenderEffect(
                  () => invokeVNodeHook(vnodeHook, parent, next, vnode),
                  parentSuspense
                );
              }
            }
          };
          instance.scope.on();
          const effect = instance.effect = new reactivity.ReactiveEffect(componentUpdateFn);
          instance.scope.off();
          const update = instance.update = effect.run.bind(effect);
          const job = instance.job = effect.runIfDirty.bind(effect);
          job.i = instance;
          job.id = instance.uid;
          effect.scheduler = () => queueJob(job);
          toggleRecurse(instance, true);
          update();
        };
        const updateComponentPreRender = (instance, nextVNode, optimized) => {
          nextVNode.component = instance;
          const prevProps = instance.vnode.props;
          instance.vnode = nextVNode;
          instance.next = null;
          updateProps(instance, nextVNode.props, prevProps, optimized);
          updateSlots(instance, nextVNode.children, optimized);
          reactivity.pauseTracking();
          flushPreFlushCbs(instance);
          reactivity.resetTracking();
        };
        const patchChildren = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized = false) => {
          const c1 = n1 && n1.children;
          const prevShapeFlag = n1 ? n1.shapeFlag : 0;
          const c2 = n2.children;
          const { patchFlag, shapeFlag } = n2;
          if (patchFlag > 0) {
            if (patchFlag & 128) {
              patchKeyedChildren(
                c1,
                c2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              return;
            } else if (patchFlag & 256) {
              patchUnkeyedChildren(
                c1,
                c2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              return;
            }
          }
          if (shapeFlag & 8) {
            if (prevShapeFlag & 16) {
              unmountChildren(c1, parentComponent, parentSuspense);
            }
            if (c2 !== c1) {
              hostSetElementText(container, c2);
            }
          } else {
            if (prevShapeFlag & 16) {
              if (shapeFlag & 16) {
                patchKeyedChildren(
                  c1,
                  c2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else {
                unmountChildren(c1, parentComponent, parentSuspense, true);
              }
            } else {
              if (prevShapeFlag & 8) {
                hostSetElementText(container, "");
              }
              if (shapeFlag & 16) {
                mountChildren(
                  c2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              }
            }
          }
        };
        const patchUnkeyedChildren = (c1, c2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          c1 = c1 || shared.EMPTY_ARR;
          c2 = c2 || shared.EMPTY_ARR;
          const oldLength = c1.length;
          const newLength = c2.length;
          const commonLength = Math.min(oldLength, newLength);
          let i;
          for (i = 0; i < commonLength; i++) {
            const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
            patch(
              c1[i],
              nextChild,
              container,
              null,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          }
          if (oldLength > newLength) {
            unmountChildren(
              c1,
              parentComponent,
              parentSuspense,
              true,
              false,
              commonLength
            );
          } else {
            mountChildren(
              c2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized,
              commonLength
            );
          }
        };
        const patchKeyedChildren = (c1, c2, container, parentAnchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          let i = 0;
          const l2 = c2.length;
          let e1 = c1.length - 1;
          let e2 = l2 - 1;
          while (i <= e1 && i <= e2) {
            const n1 = c1[i];
            const n2 = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
            if (isSameVNodeType(n1, n2)) {
              patch(
                n1,
                n2,
                container,
                null,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } else {
              break;
            }
            i++;
          }
          while (i <= e1 && i <= e2) {
            const n1 = c1[e1];
            const n2 = c2[e2] = optimized ? cloneIfMounted(c2[e2]) : normalizeVNode(c2[e2]);
            if (isSameVNodeType(n1, n2)) {
              patch(
                n1,
                n2,
                container,
                null,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } else {
              break;
            }
            e1--;
            e2--;
          }
          if (i > e1) {
            if (i <= e2) {
              const nextPos = e2 + 1;
              const anchor = nextPos < l2 ? c2[nextPos].el : parentAnchor;
              while (i <= e2) {
                patch(
                  null,
                  c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]),
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
                i++;
              }
            }
          } else if (i > e2) {
            while (i <= e1) {
              unmount(c1[i], parentComponent, parentSuspense, true);
              i++;
            }
          } else {
            const s1 = i;
            const s2 = i;
            const keyToNewIndexMap = /* @__PURE__ */ new Map();
            for (i = s2; i <= e2; i++) {
              const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
              if (nextChild.key != null) {
                keyToNewIndexMap.set(nextChild.key, i);
              }
            }
            let j;
            let patched = 0;
            const toBePatched = e2 - s2 + 1;
            let moved = false;
            let maxNewIndexSoFar = 0;
            const newIndexToOldIndexMap = new Array(toBePatched);
            for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0;
            for (i = s1; i <= e1; i++) {
              const prevChild = c1[i];
              if (patched >= toBePatched) {
                unmount(prevChild, parentComponent, parentSuspense, true);
                continue;
              }
              let newIndex;
              if (prevChild.key != null) {
                newIndex = keyToNewIndexMap.get(prevChild.key);
              } else {
                for (j = s2; j <= e2; j++) {
                  if (newIndexToOldIndexMap[j - s2] === 0 && isSameVNodeType(prevChild, c2[j])) {
                    newIndex = j;
                    break;
                  }
                }
              }
              if (newIndex === void 0) {
                unmount(prevChild, parentComponent, parentSuspense, true);
              } else {
                newIndexToOldIndexMap[newIndex - s2] = i + 1;
                if (newIndex >= maxNewIndexSoFar) {
                  maxNewIndexSoFar = newIndex;
                } else {
                  moved = true;
                }
                patch(
                  prevChild,
                  c2[newIndex],
                  container,
                  null,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
                patched++;
              }
            }
            const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : shared.EMPTY_ARR;
            j = increasingNewIndexSequence.length - 1;
            for (i = toBePatched - 1; i >= 0; i--) {
              const nextIndex = s2 + i;
              const nextChild = c2[nextIndex];
              const anchorVNode = c2[nextIndex + 1];
              const anchor = nextIndex + 1 < l2 ? (
                // #13559, #14173 fallback to el placeholder for unresolved async component
                anchorVNode.el || resolveAsyncComponentPlaceholder(anchorVNode)
              ) : parentAnchor;
              if (newIndexToOldIndexMap[i] === 0) {
                patch(
                  null,
                  nextChild,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (moved) {
                if (j < 0 || i !== increasingNewIndexSequence[j]) {
                  move(nextChild, container, anchor, 2);
                } else {
                  j--;
                }
              }
            }
          }
        };
        const move = (vnode, container, anchor, moveType, parentSuspense = null) => {
          const { el, type, transition, children, shapeFlag } = vnode;
          if (shapeFlag & 6) {
            move(vnode.component.subTree, container, anchor, moveType);
            return;
          }
          if (shapeFlag & 128) {
            vnode.suspense.move(container, anchor, moveType);
            return;
          }
          if (shapeFlag & 64) {
            type.move(vnode, container, anchor, internals);
            return;
          }
          if (type === Fragment) {
            hostInsert(el, container, anchor);
            for (let i = 0; i < children.length; i++) {
              move(children[i], container, anchor, moveType);
            }
            hostInsert(vnode.anchor, container, anchor);
            return;
          }
          if (type === Static) {
            moveStaticNode(vnode, container, anchor);
            return;
          }
          const needTransition2 = moveType !== 2 && shapeFlag & 1 && transition;
          if (needTransition2) {
            if (moveType === 0) {
              if (transition.persisted && !el[leaveCbKey]) {
                hostInsert(el, container, anchor);
              } else {
                transition.beforeEnter(el);
                hostInsert(el, container, anchor);
                queuePostRenderEffect(() => transition.enter(el), parentSuspense);
              }
            } else {
              const { leave, delayLeave, afterLeave } = transition;
              const remove2 = () => {
                if (vnode.ctx.isUnmounted) {
                  hostRemove(el);
                } else {
                  hostInsert(el, container, anchor);
                }
              };
              const performLeave = () => {
                const wasLeaving = el._isLeaving || !!el[leaveCbKey];
                if (el._isLeaving) {
                  el[leaveCbKey](
                    true
                    /* cancelled */
                  );
                }
                if (transition.persisted && !wasLeaving) {
                  remove2();
                } else {
                  leave(el, () => {
                    remove2();
                    afterLeave && afterLeave();
                  });
                }
              };
              if (delayLeave) {
                delayLeave(el, remove2, performLeave);
              } else {
                performLeave();
              }
            }
          } else {
            hostInsert(el, container, anchor);
          }
        };
        const unmount = (vnode, parentComponent, parentSuspense, doRemove = false, optimized = false) => {
          const {
            type,
            props,
            ref: ref2,
            children,
            dynamicChildren,
            shapeFlag,
            patchFlag,
            dirs,
            cacheIndex,
            memo
          } = vnode;
          if (patchFlag === -2) {
            optimized = false;
          }
          if (ref2 != null) {
            reactivity.pauseTracking();
            setRef(ref2, null, parentSuspense, vnode, true);
            reactivity.resetTracking();
          }
          if (cacheIndex != null) {
            parentComponent.renderCache[cacheIndex] = void 0;
          }
          if (shapeFlag & 256) {
            parentComponent.ctx.deactivate(vnode);
            return;
          }
          const shouldInvokeDirs = shapeFlag & 1 && dirs;
          const shouldInvokeVnodeHook = !isAsyncWrapper(vnode);
          let vnodeHook;
          if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeBeforeUnmount)) {
            invokeVNodeHook(vnodeHook, parentComponent, vnode);
          }
          if (shapeFlag & 6) {
            unmountComponent(vnode.component, parentSuspense, doRemove);
          } else {
            if (shapeFlag & 128) {
              vnode.suspense.unmount(parentSuspense, doRemove);
              return;
            }
            if (shouldInvokeDirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "beforeUnmount");
            }
            if (shapeFlag & 64) {
              vnode.type.remove(
                vnode,
                parentComponent,
                parentSuspense,
                internals,
                doRemove
              );
            } else if (dynamicChildren && // #5154
            // when v-once is used inside a block, setBlockTracking(-1) marks the
            // parent block with hasOnce: true
            // so that it doesn't take the fast path during unmount - otherwise
            // components nested in v-once are never unmounted.
            !dynamicChildren.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
            (type !== Fragment || patchFlag > 0 && patchFlag & 64)) {
              unmountChildren(
                dynamicChildren,
                parentComponent,
                parentSuspense,
                false,
                true
              );
            } else if (type === Fragment && patchFlag & (128 | 256) || !optimized && shapeFlag & 16) {
              unmountChildren(children, parentComponent, parentSuspense);
            }
            if (doRemove) {
              remove(vnode);
            }
          }
          const shouldInvalidateMemo = memo != null && cacheIndex == null;
          if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs || shouldInvalidateMemo) {
            queuePostRenderEffect(() => {
              vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
              shouldInvokeDirs && invokeDirectiveHook(vnode, null, parentComponent, "unmounted");
              if (shouldInvalidateMemo) {
                vnode.el = null;
              }
            }, parentSuspense);
          }
        };
        const remove = (vnode) => {
          const { type, el, anchor, transition } = vnode;
          if (type === Fragment) {
            {
              removeFragment(el, anchor);
            }
            return;
          }
          if (type === Static) {
            removeStaticNode(vnode);
            return;
          }
          const performRemove = () => {
            hostRemove(el);
            if (transition && !transition.persisted && transition.afterLeave) {
              transition.afterLeave();
            }
          };
          if (vnode.shapeFlag & 1 && transition && !transition.persisted) {
            const { leave, delayLeave } = transition;
            const performLeave = () => leave(el, performRemove);
            if (delayLeave) {
              delayLeave(vnode.el, performRemove, performLeave);
            } else {
              performLeave();
            }
          } else {
            performRemove();
          }
        };
        const removeFragment = (cur, end) => {
          let next;
          while (cur !== end) {
            next = hostNextSibling(cur);
            hostRemove(cur);
            cur = next;
          }
          hostRemove(end);
        };
        const unmountComponent = (instance, parentSuspense, doRemove) => {
          const { bum, scope, job, subTree, um, m, a } = instance;
          invalidateMount(m);
          invalidateMount(a);
          if (bum) {
            shared.invokeArrayFns(bum);
          }
          scope.stop();
          if (job) {
            job.flags |= 8;
            unmount(subTree, instance, parentSuspense, doRemove);
          }
          if (um) {
            queuePostRenderEffect(um, parentSuspense);
          }
          queuePostRenderEffect(() => {
            instance.isUnmounted = true;
          }, parentSuspense);
        };
        const unmountChildren = (children, parentComponent, parentSuspense, doRemove = false, optimized = false, start = 0) => {
          for (let i = start; i < children.length; i++) {
            unmount(children[i], parentComponent, parentSuspense, doRemove, optimized);
          }
        };
        const getNextHostNode = (vnode) => {
          if (vnode.shapeFlag & 6) {
            return getNextHostNode(vnode.component.subTree);
          }
          if (vnode.shapeFlag & 128) {
            return vnode.suspense.next();
          }
          const el = hostNextSibling(vnode.anchor || vnode.el);
          const teleportEnd = el && el[TeleportEndKey];
          return teleportEnd ? hostNextSibling(teleportEnd) : el;
        };
        let isFlushing = false;
        const render2 = (vnode, container, namespace) => {
          let instance;
          if (vnode == null) {
            if (container._vnode) {
              unmount(container._vnode, null, null, true);
              instance = container._vnode.component;
            }
          } else {
            patch(
              container._vnode || null,
              vnode,
              container,
              null,
              null,
              null,
              namespace
            );
          }
          container._vnode = vnode;
          if (!isFlushing) {
            isFlushing = true;
            flushPreFlushCbs(instance);
            flushPostFlushCbs();
            isFlushing = false;
          }
        };
        const internals = {
          p: patch,
          um: unmount,
          m: move,
          r: remove,
          mt: mountComponent,
          mc: mountChildren,
          pc: patchChildren,
          pbc: patchBlockChildren,
          n: getNextHostNode,
          o: options
        };
        let hydrate;
        let hydrateNode;
        if (createHydrationFns) {
          [hydrate, hydrateNode] = createHydrationFns(
            internals
          );
        }
        return {
          render: render2,
          hydrate,
          createApp: createAppAPI(render2, hydrate)
        };
      }
      function resolveChildrenNamespace({ type, props }, currentNamespace) {
        return currentNamespace === "svg" && type === "foreignObject" || currentNamespace === "mathml" && type === "annotation-xml" && props && props.encoding && props.encoding.includes("html") ? void 0 : currentNamespace;
      }
      function toggleRecurse({ effect, job }, allowed) {
        if (allowed) {
          effect.flags |= 32;
          job.flags |= 4;
        } else {
          effect.flags &= -33;
          job.flags &= -5;
        }
      }
      function needTransition(parentSuspense, transition) {
        return (!parentSuspense || parentSuspense && !parentSuspense.pendingBranch) && transition && !transition.persisted;
      }
      function traverseStaticChildren(n1, n2, shallow = false) {
        const ch1 = n1.children;
        const ch2 = n2.children;
        if (shared.isArray(ch1) && shared.isArray(ch2)) {
          for (let i = 0; i < ch1.length; i++) {
            const c1 = ch1[i];
            let c2 = ch2[i];
            if (c2.shapeFlag & 1 && !c2.dynamicChildren) {
              if (c2.patchFlag <= 0 || c2.patchFlag === 32) {
                c2 = ch2[i] = cloneIfMounted(ch2[i]);
                c2.el = c1.el;
              }
              if (!shallow && c2.patchFlag !== -2)
                traverseStaticChildren(c1, c2);
            }
            if (c2.type === Text) {
              if (c2.patchFlag === -1) {
                c2 = ch2[i] = cloneIfMounted(c2);
              }
              c2.el = c1.el;
            }
            if (c2.type === Comment && !c2.el) {
              c2.el = c1.el;
            }
          }
        }
      }
      function getSequence(arr) {
        const p = arr.slice();
        const result = [0];
        let i, j, u, v, c;
        const len = arr.length;
        for (i = 0; i < len; i++) {
          const arrI = arr[i];
          if (arrI !== 0) {
            j = result[result.length - 1];
            if (arr[j] < arrI) {
              p[i] = j;
              result.push(i);
              continue;
            }
            u = 0;
            v = result.length - 1;
            while (u < v) {
              c = u + v >> 1;
              if (arr[result[c]] < arrI) {
                u = c + 1;
              } else {
                v = c;
              }
            }
            if (arrI < arr[result[u]]) {
              if (u > 0) {
                p[i] = result[u - 1];
              }
              result[u] = i;
            }
          }
        }
        u = result.length;
        v = result[u - 1];
        while (u-- > 0) {
          result[u] = v;
          v = p[v];
        }
        return result;
      }
      function locateNonHydratedAsyncRoot(instance) {
        const subComponent = instance.subTree.component;
        if (subComponent) {
          if (subComponent.asyncDep && !subComponent.asyncResolved) {
            return subComponent;
          } else {
            return locateNonHydratedAsyncRoot(subComponent);
          }
        }
      }
      function invalidateMount(hooks) {
        if (hooks) {
          for (let i = 0; i < hooks.length; i++)
            hooks[i].flags |= 8;
        }
      }
      function resolveAsyncComponentPlaceholder(anchorVnode) {
        if (anchorVnode.placeholder) {
          return anchorVnode.placeholder;
        }
        const instance = anchorVnode.component;
        if (instance) {
          return resolveAsyncComponentPlaceholder(instance.subTree);
        }
        return null;
      }
      var isSuspense = (type) => type.__isSuspense;
      var suspenseId = 0;
      var SuspenseImpl = {
        name: "Suspense",
        // In order to make Suspense tree-shakable, we need to avoid importing it
        // directly in the renderer. The renderer checks for the __isSuspense flag
        // on a vnode's type and calls the `process` method, passing in renderer
        // internals.
        __isSuspense: true,
        process(n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals) {
          if (n1 == null) {
            mountSuspense(
              n2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized,
              rendererInternals
            );
          } else {
            if (parentSuspense && parentSuspense.deps > 0 && !n1.suspense.isInFallback) {
              n2.suspense = n1.suspense;
              n2.suspense.vnode = n2;
              n2.el = n1.el;
              return;
            }
            patchSuspense(
              n1,
              n2,
              container,
              anchor,
              parentComponent,
              namespace,
              slotScopeIds,
              optimized,
              rendererInternals
            );
          }
        },
        hydrate: hydrateSuspense,
        normalize: normalizeSuspenseChildren
      };
      var Suspense = SuspenseImpl;
      function triggerEvent(vnode, name) {
        const eventListener = vnode.props && vnode.props[name];
        if (shared.isFunction(eventListener)) {
          eventListener();
        }
      }
      function mountSuspense(vnode, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals) {
        const {
          p: patch,
          o: { createElement }
        } = rendererInternals;
        const hiddenContainer = createElement("div");
        const suspense = vnode.suspense = createSuspenseBoundary(
          vnode,
          parentSuspense,
          parentComponent,
          container,
          hiddenContainer,
          anchor,
          namespace,
          slotScopeIds,
          optimized,
          rendererInternals
        );
        patch(
          null,
          suspense.pendingBranch = vnode.ssContent,
          hiddenContainer,
          null,
          parentComponent,
          suspense,
          namespace,
          slotScopeIds
        );
        if (suspense.deps > 0) {
          triggerEvent(vnode, "onPending");
          triggerEvent(vnode, "onFallback");
          patch(
            null,
            vnode.ssFallback,
            container,
            anchor,
            parentComponent,
            null,
            // fallback tree will not have suspense context
            namespace,
            slotScopeIds
          );
          setActiveBranch(suspense, vnode.ssFallback);
        } else {
          suspense.resolve(false, true);
        }
      }
      function patchSuspense(n1, n2, container, anchor, parentComponent, namespace, slotScopeIds, optimized, { p: patch, um: unmount, o: { createElement } }) {
        const suspense = n2.suspense = n1.suspense;
        suspense.vnode = n2;
        n2.el = n1.el;
        const newBranch = n2.ssContent;
        const newFallback = n2.ssFallback;
        const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense;
        if (pendingBranch) {
          suspense.pendingBranch = newBranch;
          if (isSameVNodeType(pendingBranch, newBranch)) {
            patch(
              pendingBranch,
              newBranch,
              suspense.hiddenContainer,
              null,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            if (suspense.deps <= 0) {
              suspense.resolve();
            } else if (isInFallback) {
              if (!isHydrating && !suspense.isFallbackMountPending) {
                patch(
                  activeBranch,
                  newFallback,
                  container,
                  anchor,
                  parentComponent,
                  null,
                  // fallback tree will not have suspense context
                  namespace,
                  slotScopeIds,
                  optimized
                );
                setActiveBranch(suspense, newFallback);
              }
            }
          } else {
            suspense.pendingId = suspenseId++;
            if (isHydrating) {
              suspense.isHydrating = false;
              suspense.activeBranch = pendingBranch;
            } else {
              unmount(pendingBranch, parentComponent, suspense);
            }
            suspense.deps = 0;
            suspense.effects.length = 0;
            suspense.hiddenContainer = createElement("div");
            if (isInFallback) {
              patch(
                null,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              if (suspense.deps <= 0) {
                suspense.resolve();
              } else if (!suspense.isFallbackMountPending) {
                patch(
                  activeBranch,
                  newFallback,
                  container,
                  anchor,
                  parentComponent,
                  null,
                  // fallback tree will not have suspense context
                  namespace,
                  slotScopeIds,
                  optimized
                );
                setActiveBranch(suspense, newFallback);
              }
            } else if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
              patch(
                activeBranch,
                newBranch,
                container,
                anchor,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              suspense.resolve(true);
            } else {
              patch(
                null,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              if (suspense.deps <= 0) {
                suspense.resolve();
              }
            }
          }
        } else {
          if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
            patch(
              activeBranch,
              newBranch,
              container,
              anchor,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            setActiveBranch(suspense, newBranch);
          } else {
            triggerEvent(n2, "onPending");
            suspense.pendingBranch = newBranch;
            if (newBranch.shapeFlag & 512) {
              suspense.pendingId = newBranch.component.suspenseId;
            } else {
              suspense.pendingId = suspenseId++;
            }
            patch(
              null,
              newBranch,
              suspense.hiddenContainer,
              null,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            if (suspense.deps <= 0) {
              suspense.resolve();
            } else {
              const { timeout, pendingId } = suspense;
              if (timeout > 0) {
                setTimeout(() => {
                  if (suspense.pendingId === pendingId) {
                    suspense.fallback(newFallback);
                  }
                }, timeout);
              } else if (timeout === 0) {
                suspense.fallback(newFallback);
              }
            }
          }
        }
      }
      function createSuspenseBoundary(vnode, parentSuspense, parentComponent, container, hiddenContainer, anchor, namespace, slotScopeIds, optimized, rendererInternals, isHydrating = false) {
        const {
          p: patch,
          m: move,
          um: unmount,
          n: next,
          o: { parentNode, remove }
        } = rendererInternals;
        let parentSuspenseId;
        const isSuspensible = isVNodeSuspensible(vnode);
        if (isSuspensible) {
          if (parentSuspense && parentSuspense.pendingBranch) {
            parentSuspenseId = parentSuspense.pendingId;
            parentSuspense.deps++;
          }
        }
        const timeout = vnode.props ? shared.toNumber(vnode.props.timeout) : void 0;
        const initialAnchor = anchor;
        const suspense = {
          vnode,
          parent: parentSuspense,
          parentComponent,
          namespace,
          container,
          hiddenContainer,
          deps: 0,
          pendingId: suspenseId++,
          timeout: typeof timeout === "number" ? timeout : -1,
          activeBranch: null,
          isFallbackMountPending: false,
          pendingBranch: null,
          isInFallback: !isHydrating,
          isHydrating,
          isUnmounted: false,
          effects: [],
          resolve(resume = false, sync = false) {
            const {
              vnode: vnode2,
              activeBranch,
              pendingBranch,
              pendingId,
              effects,
              parentComponent: parentComponent2,
              container: container2,
              isInFallback
            } = suspense;
            let delayEnter = false;
            if (suspense.isHydrating) {
              suspense.isHydrating = false;
            } else if (!resume) {
              delayEnter = activeBranch && pendingBranch.transition && pendingBranch.transition.mode === "out-in";
              let hasUpdatedAnchor = false;
              if (delayEnter) {
                activeBranch.transition.afterLeave = () => {
                  if (pendingId === suspense.pendingId) {
                    move(
                      pendingBranch,
                      container2,
                      anchor === initialAnchor && !hasUpdatedAnchor ? next(activeBranch) : anchor,
                      0
                    );
                    queuePostFlushCb(effects);
                    if (isInFallback && vnode2.ssFallback) {
                      vnode2.ssFallback.el = null;
                    }
                  }
                };
              }
              if (activeBranch && !suspense.isFallbackMountPending) {
                if (parentNode(activeBranch.el) === container2) {
                  anchor = next(activeBranch);
                  hasUpdatedAnchor = true;
                }
                unmount(activeBranch, parentComponent2, suspense, true);
                if (!delayEnter && isInFallback && vnode2.ssFallback) {
                  queuePostRenderEffect(() => vnode2.ssFallback.el = null, suspense);
                }
              }
              if (!delayEnter) {
                move(pendingBranch, container2, anchor, 0);
              }
            }
            suspense.isFallbackMountPending = false;
            setActiveBranch(suspense, pendingBranch);
            suspense.pendingBranch = null;
            suspense.isInFallback = false;
            let parent = suspense.parent;
            let hasUnresolvedAncestor = false;
            while (parent) {
              if (parent.pendingBranch) {
                for (let i = 0; i < effects.length; i++) {
                  parent.effects.push(effects[i]);
                }
                hasUnresolvedAncestor = true;
                break;
              }
              parent = parent.parent;
            }
            if (!hasUnresolvedAncestor && !delayEnter) {
              queuePostFlushCb(effects);
            }
            suspense.effects = [];
            if (isSuspensible) {
              if (parentSuspense && parentSuspense.pendingBranch && parentSuspenseId === parentSuspense.pendingId) {
                parentSuspense.deps--;
                if (parentSuspense.deps === 0 && !sync) {
                  parentSuspense.resolve();
                }
              }
            }
            triggerEvent(vnode2, "onResolve");
          },
          fallback(fallbackVNode) {
            if (!suspense.pendingBranch) {
              return;
            }
            const { vnode: vnode2, activeBranch, parentComponent: parentComponent2, container: container2, namespace: namespace2 } = suspense;
            triggerEvent(vnode2, "onFallback");
            const anchor2 = next(activeBranch);
            const mountFallback = () => {
              suspense.isFallbackMountPending = false;
              if (!suspense.isInFallback) {
                return;
              }
              const latestFallback = suspense.vnode.ssFallback;
              patch(
                null,
                latestFallback,
                container2,
                anchor2,
                parentComponent2,
                null,
                // fallback tree will not have suspense context
                namespace2,
                slotScopeIds,
                optimized
              );
              setActiveBranch(suspense, latestFallback);
            };
            const delayEnter = fallbackVNode.transition && fallbackVNode.transition.mode === "out-in";
            if (delayEnter) {
              suspense.isFallbackMountPending = true;
              activeBranch.transition.afterLeave = mountFallback;
            }
            suspense.isInFallback = true;
            unmount(
              activeBranch,
              parentComponent2,
              null,
              // no suspense so unmount hooks fire now
              true
              // shouldRemove
            );
            if (!delayEnter) {
              mountFallback();
            }
          },
          move(container2, anchor2, type) {
            suspense.activeBranch && move(suspense.activeBranch, container2, anchor2, type);
            suspense.container = container2;
          },
          next() {
            return suspense.activeBranch && next(suspense.activeBranch);
          },
          registerDep(instance, setupRenderEffect, optimized2) {
            const isInPendingSuspense = !!suspense.pendingBranch;
            if (isInPendingSuspense) {
              suspense.deps++;
            }
            const hydratedEl = instance.vnode.el;
            instance.asyncDep.catch((err) => {
              handleError(err, instance, 0);
            }).then((asyncSetupResult) => {
              if (instance.isUnmounted || suspense.isUnmounted || suspense.pendingId !== instance.suspenseId) {
                return;
              }
              unsetCurrentInstance();
              instance.asyncResolved = true;
              const { vnode: vnode2 } = instance;
              handleSetupResult(instance, asyncSetupResult, false);
              if (hydratedEl) {
                vnode2.el = hydratedEl;
              }
              const placeholder = !hydratedEl && instance.subTree.el;
              setupRenderEffect(
                instance,
                vnode2,
                // component may have been moved before resolve.
                // if this is not a hydration, instance.subTree will be the comment
                // placeholder.
                parentNode(hydratedEl || instance.subTree.el),
                // anchor will not be used if this is hydration, so only need to
                // consider the comment placeholder case.
                hydratedEl ? null : next(instance.subTree),
                suspense,
                namespace,
                optimized2
              );
              if (placeholder) {
                vnode2.placeholder = null;
                remove(placeholder);
              }
              updateHOCHostEl(instance, vnode2.el);
              if (isInPendingSuspense && --suspense.deps === 0) {
                suspense.resolve();
              }
            });
          },
          unmount(parentSuspense2, doRemove) {
            suspense.isUnmounted = true;
            if (suspense.activeBranch) {
              unmount(
                suspense.activeBranch,
                parentComponent,
                parentSuspense2,
                doRemove
              );
            }
            if (suspense.pendingBranch) {
              unmount(
                suspense.pendingBranch,
                parentComponent,
                parentSuspense2,
                doRemove
              );
            }
          }
        };
        return suspense;
      }
      function hydrateSuspense(node, vnode, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals, hydrateNode) {
        const suspense = vnode.suspense = createSuspenseBoundary(
          vnode,
          parentSuspense,
          parentComponent,
          node.parentNode,
          // eslint-disable-next-line no-restricted-globals
          document.createElement("div"),
          null,
          namespace,
          slotScopeIds,
          optimized,
          rendererInternals,
          true
        );
        const result = hydrateNode(
          node,
          suspense.pendingBranch = vnode.ssContent,
          parentComponent,
          suspense,
          slotScopeIds,
          optimized
        );
        if (suspense.deps === 0) {
          suspense.resolve(false, true);
        }
        return result;
      }
      function normalizeSuspenseChildren(vnode) {
        const { shapeFlag, children } = vnode;
        const isSlotChildren = shapeFlag & 32;
        vnode.ssContent = normalizeSuspenseSlot(
          isSlotChildren ? children.default : children
        );
        vnode.ssFallback = isSlotChildren ? normalizeSuspenseSlot(children.fallback) : createVNode(Comment);
      }
      function normalizeSuspenseSlot(s) {
        let block;
        if (shared.isFunction(s)) {
          const trackBlock = isBlockTreeEnabled && s._c;
          if (trackBlock) {
            s._d = false;
            openBlock();
          }
          s = s();
          if (trackBlock) {
            s._d = true;
            block = currentBlock;
            closeBlock();
          }
        }
        if (shared.isArray(s)) {
          const singleChild = filterSingleRoot(s);
          s = singleChild;
        }
        s = normalizeVNode(s);
        if (block && !s.dynamicChildren) {
          s.dynamicChildren = block.filter((c) => c !== s);
        }
        return s;
      }
      function queueEffectWithSuspense(fn, suspense) {
        if (suspense && suspense.pendingBranch) {
          if (shared.isArray(fn)) {
            suspense.effects.push(...fn);
          } else {
            suspense.effects.push(fn);
          }
        } else {
          queuePostFlushCb(fn);
        }
      }
      function setActiveBranch(suspense, branch) {
        suspense.activeBranch = branch;
        const { vnode, parentComponent } = suspense;
        let el = branch.el;
        while (!el && branch.component) {
          branch = branch.component.subTree;
          el = branch.el;
        }
        vnode.el = el;
        if (parentComponent && parentComponent.subTree === vnode) {
          parentComponent.vnode.el = el;
          updateHOCHostEl(parentComponent, el);
        }
      }
      function isVNodeSuspensible(vnode) {
        const suspensible = vnode.props && vnode.props.suspensible;
        return suspensible != null && suspensible !== false;
      }
      var Fragment = /* @__PURE__ */ Symbol.for("v-fgt");
      var Text = /* @__PURE__ */ Symbol.for("v-txt");
      var Comment = /* @__PURE__ */ Symbol.for("v-cmt");
      var Static = /* @__PURE__ */ Symbol.for("v-stc");
      var blockStack = [];
      var currentBlock = null;
      function openBlock(disableTracking = false) {
        blockStack.push(currentBlock = disableTracking ? null : []);
      }
      function closeBlock() {
        blockStack.pop();
        currentBlock = blockStack[blockStack.length - 1] || null;
      }
      var isBlockTreeEnabled = 1;
      function setBlockTracking(value, inVOnce = false) {
        isBlockTreeEnabled += value;
        if (value < 0 && currentBlock && inVOnce) {
          currentBlock.hasOnce = true;
        }
      }
      function setupBlock(vnode) {
        vnode.dynamicChildren = isBlockTreeEnabled > 0 ? currentBlock || shared.EMPTY_ARR : null;
        closeBlock();
        if (isBlockTreeEnabled > 0 && currentBlock) {
          currentBlock.push(vnode);
        }
        return vnode;
      }
      function createElementBlock(type, props, children, patchFlag, dynamicProps, shapeFlag) {
        return setupBlock(
          createBaseVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            shapeFlag,
            true
          )
        );
      }
      function createBlock(type, props, children, patchFlag, dynamicProps) {
        return setupBlock(
          createVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            true
          )
        );
      }
      function isVNode(value) {
        return value ? value.__v_isVNode === true : false;
      }
      function isSameVNodeType(n1, n2) {
        return n1.type === n2.type && n1.key === n2.key;
      }
      function transformVNodeArgs(transformer) {
      }
      var normalizeKey = ({ key }) => key != null ? key : null;
      var normalizeRef = ({
        ref: ref2,
        ref_key,
        ref_for
      }) => {
        if (typeof ref2 === "number") {
          ref2 = "" + ref2;
        }
        return ref2 != null ? shared.isString(ref2) || reactivity.isRef(ref2) || shared.isFunction(ref2) ? { i: currentRenderingInstance, r: ref2, k: ref_key, f: !!ref_for } : ref2 : null;
      };
      function createBaseVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, shapeFlag = type === Fragment ? 0 : 1, isBlockNode = false, needFullChildrenNormalization = false) {
        const vnode = {
          __v_isVNode: true,
          __v_skip: true,
          type,
          props,
          key: props && normalizeKey(props),
          ref: props && normalizeRef(props),
          scopeId: currentScopeId,
          slotScopeIds: null,
          children,
          component: null,
          suspense: null,
          ssContent: null,
          ssFallback: null,
          dirs: null,
          transition: null,
          el: null,
          anchor: null,
          target: null,
          targetStart: null,
          targetAnchor: null,
          staticCount: 0,
          shapeFlag,
          patchFlag,
          dynamicProps,
          dynamicChildren: null,
          appContext: null,
          ctx: currentRenderingInstance
        };
        if (needFullChildrenNormalization) {
          normalizeChildren(vnode, children);
          if (shapeFlag & 128) {
            type.normalize(vnode);
          }
        } else if (children) {
          vnode.shapeFlag |= shared.isString(children) ? 8 : 16;
        }
        if (isBlockTreeEnabled > 0 && // avoid a block node from tracking itself
        !isBlockNode && // has current parent block
        currentBlock && // presence of a patch flag indicates this node needs patching on updates.
        // component nodes also should always be patched, because even if the
        // component doesn't need to update, it needs to persist the instance on to
        // the next vnode so that it can be properly unmounted later.
        (vnode.patchFlag > 0 || shapeFlag & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
        // vnode should not be considered dynamic due to handler caching.
        vnode.patchFlag !== 32) {
          currentBlock.push(vnode);
        }
        return vnode;
      }
      var createVNode = _createVNode2;
      function _createVNode2(type, props = null, children = null, patchFlag = 0, dynamicProps = null, isBlockNode = false) {
        if (!type || type === NULL_DYNAMIC_COMPONENT) {
          type = Comment;
        }
        if (isVNode(type)) {
          const cloned = cloneVNode(
            type,
            props,
            true
            /* mergeRef: true */
          );
          if (children) {
            normalizeChildren(cloned, children);
          }
          if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
            if (cloned.shapeFlag & 6) {
              currentBlock[currentBlock.indexOf(type)] = cloned;
            } else {
              currentBlock.push(cloned);
            }
          }
          cloned.patchFlag = -2;
          return cloned;
        }
        if (isClassComponent(type)) {
          type = type.__vccOpts;
        }
        if (props) {
          props = guardReactiveProps(props);
          let { class: klass, style } = props;
          if (klass && !shared.isString(klass)) {
            props.class = shared.normalizeClass(klass);
          }
          if (shared.isObject(style)) {
            if (reactivity.isProxy(style) && !shared.isArray(style)) {
              style = shared.extend({}, style);
            }
            props.style = shared.normalizeStyle(style);
          }
        }
        const shapeFlag = shared.isString(type) ? 1 : isSuspense(type) ? 128 : isTeleport(type) ? 64 : shared.isObject(type) ? 4 : shared.isFunction(type) ? 2 : 0;
        return createBaseVNode(
          type,
          props,
          children,
          patchFlag,
          dynamicProps,
          shapeFlag,
          isBlockNode,
          true
        );
      }
      function guardReactiveProps(props) {
        if (!props) return null;
        return reactivity.isProxy(props) || isInternalObject(props) ? shared.extend({}, props) : props;
      }
      function cloneVNode(vnode, extraProps, mergeRef = false, cloneTransition = false) {
        const { props, ref: ref2, patchFlag, children, transition } = vnode;
        const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props;
        const cloned = {
          __v_isVNode: true,
          __v_skip: true,
          type: vnode.type,
          props: mergedProps,
          key: mergedProps && normalizeKey(mergedProps),
          ref: extraProps && extraProps.ref ? (
            // #2078 in the case of <component :is="vnode" ref="extra"/>
            // if the vnode itself already has a ref, cloneVNode will need to merge
            // the refs so the single vnode can be set on multiple refs
            mergeRef && ref2 ? shared.isArray(ref2) ? ref2.concat(normalizeRef(extraProps)) : [ref2, normalizeRef(extraProps)] : normalizeRef(extraProps)
          ) : ref2,
          scopeId: vnode.scopeId,
          slotScopeIds: vnode.slotScopeIds,
          children,
          target: vnode.target,
          targetStart: vnode.targetStart,
          targetAnchor: vnode.targetAnchor,
          staticCount: vnode.staticCount,
          shapeFlag: vnode.shapeFlag,
          // if the vnode is cloned with extra props, we can no longer assume its
          // existing patch flag to be reliable and need to add the FULL_PROPS flag.
          // note: preserve flag for fragments since they use the flag for children
          // fast paths only.
          patchFlag: extraProps && vnode.type !== Fragment ? patchFlag === -1 ? 16 : patchFlag | 16 : patchFlag,
          dynamicProps: vnode.dynamicProps,
          dynamicChildren: vnode.dynamicChildren,
          appContext: vnode.appContext,
          dirs: vnode.dirs,
          transition,
          // These should technically only be non-null on mounted VNodes. However,
          // they *should* be copied for kept-alive vnodes. So we just always copy
          // them since them being non-null during a mount doesn't affect the logic as
          // they will simply be overwritten.
          component: vnode.component,
          suspense: vnode.suspense,
          ssContent: vnode.ssContent && cloneVNode(vnode.ssContent),
          ssFallback: vnode.ssFallback && cloneVNode(vnode.ssFallback),
          placeholder: vnode.placeholder,
          el: vnode.el,
          anchor: vnode.anchor,
          ctx: vnode.ctx,
          ce: vnode.ce
        };
        if (transition && cloneTransition) {
          setTransitionHooks(
            cloned,
            transition.clone(cloned)
          );
        }
        return cloned;
      }
      function createTextVNode(text = " ", flag = 0) {
        return createVNode(Text, null, text, flag);
      }
      function createStaticVNode(content, numberOfNodes) {
        const vnode = createVNode(Static, null, content);
        vnode.staticCount = numberOfNodes;
        return vnode;
      }
      function createCommentVNode(text = "", asBlock = false) {
        return asBlock ? (openBlock(), createBlock(Comment, null, text)) : createVNode(Comment, null, text);
      }
      function normalizeVNode(child) {
        if (child == null || typeof child === "boolean") {
          return createVNode(Comment);
        } else if (shared.isArray(child)) {
          return createVNode(
            Fragment,
            null,
            // #3666, avoid reference pollution when reusing vnode
            child.slice()
          );
        } else if (isVNode(child)) {
          return cloneIfMounted(child);
        } else {
          return createVNode(Text, null, String(child));
        }
      }
      function cloneIfMounted(child) {
        return child.el === null && child.patchFlag !== -1 || child.memo ? child : cloneVNode(child);
      }
      function normalizeChildren(vnode, children) {
        let type = 0;
        const { shapeFlag } = vnode;
        if (children == null) {
          children = null;
        } else if (shared.isArray(children)) {
          type = 16;
        } else if (typeof children === "object") {
          if (shapeFlag & (1 | 64)) {
            const slot = children.default;
            if (slot) {
              slot._c && (slot._d = false);
              normalizeChildren(vnode, slot());
              slot._c && (slot._d = true);
            }
            return;
          } else {
            type = 32;
            const slotFlag = children._;
            if (!slotFlag && !isInternalObject(children)) {
              children._ctx = currentRenderingInstance;
            } else if (slotFlag === 3 && currentRenderingInstance) {
              if (currentRenderingInstance.slots._ === 1) {
                children._ = 1;
              } else {
                children._ = 2;
                vnode.patchFlag |= 1024;
              }
            }
          }
        } else if (shared.isFunction(children)) {
          if (shapeFlag & (1 | 64)) {
            normalizeChildren(vnode, { default: children });
            return;
          }
          children = { default: children, _ctx: currentRenderingInstance };
          type = 32;
        } else {
          children = String(children);
          if (shapeFlag & 64) {
            type = 16;
            children = [createTextVNode(children)];
          } else {
            type = 8;
          }
        }
        vnode.children = children;
        vnode.shapeFlag |= type;
      }
      function mergeProps(...args) {
        const ret = {};
        for (let i = 0; i < args.length; i++) {
          const toMerge = args[i];
          for (const key in toMerge) {
            if (key === "class") {
              if (ret.class !== toMerge.class) {
                ret.class = shared.normalizeClass([ret.class, toMerge.class]);
              }
            } else if (key === "style") {
              ret.style = shared.normalizeStyle([ret.style, toMerge.style]);
            } else if (shared.isOn(key)) {
              const existing = ret[key];
              const incoming = toMerge[key];
              if (incoming && existing !== incoming && !(shared.isArray(existing) && existing.includes(incoming))) {
                ret[key] = existing ? [].concat(existing, incoming) : incoming;
              } else if (incoming == null && existing == null && // mergeProps({ 'onUpdate:modelValue': undefined }) should not retain
              // the model listener.
              !shared.isModelListener(key)) {
                ret[key] = incoming;
              }
            } else if (key !== "") {
              ret[key] = toMerge[key];
            }
          }
        }
        return ret;
      }
      function invokeVNodeHook(hook, instance, vnode, prevVNode = null) {
        callWithAsyncErrorHandling(hook, instance, 7, [
          vnode,
          prevVNode
        ]);
      }
      var emptyAppContext = createAppContext();
      var uid = 0;
      function createComponentInstance(vnode, parent, suspense) {
        const type = vnode.type;
        const appContext = (parent ? parent.appContext : vnode.appContext) || emptyAppContext;
        const instance = {
          uid: uid++,
          vnode,
          type,
          parent,
          appContext,
          root: null,
          // to be immediately set
          next: null,
          subTree: null,
          // will be set synchronously right after creation
          effect: null,
          update: null,
          // will be set synchronously right after creation
          job: null,
          scope: new reactivity.EffectScope(
            true
            /* detached */
          ),
          render: null,
          proxy: null,
          exposed: null,
          exposeProxy: null,
          withProxy: null,
          provides: parent ? parent.provides : Object.create(appContext.provides),
          ids: parent ? parent.ids : ["", 0, 0],
          accessCache: null,
          renderCache: [],
          // local resolved assets
          components: null,
          directives: null,
          // resolved props and emits options
          propsOptions: normalizePropsOptions(type, appContext),
          emitsOptions: normalizeEmitsOptions(type, appContext),
          // emit
          emit: null,
          // to be set immediately
          emitted: null,
          // props default value
          propsDefaults: shared.EMPTY_OBJ,
          // inheritAttrs
          inheritAttrs: type.inheritAttrs,
          // state
          ctx: shared.EMPTY_OBJ,
          data: shared.EMPTY_OBJ,
          props: shared.EMPTY_OBJ,
          attrs: shared.EMPTY_OBJ,
          slots: shared.EMPTY_OBJ,
          refs: shared.EMPTY_OBJ,
          setupState: shared.EMPTY_OBJ,
          setupContext: null,
          // suspense related
          suspense,
          suspenseId: suspense ? suspense.pendingId : 0,
          asyncDep: null,
          asyncResolved: false,
          // lifecycle hooks
          // not using enums here because it results in computed properties
          isMounted: false,
          isUnmounted: false,
          isDeactivated: false,
          bc: null,
          c: null,
          bm: null,
          m: null,
          bu: null,
          u: null,
          um: null,
          bum: null,
          da: null,
          a: null,
          rtg: null,
          rtc: null,
          ec: null,
          sp: null
        };
        {
          instance.ctx = { _: instance };
        }
        instance.root = parent ? parent.root : instance;
        instance.emit = emit.bind(null, instance);
        if (vnode.ce) {
          vnode.ce(instance);
        }
        return instance;
      }
      var currentInstance = null;
      var getCurrentInstance2 = () => currentInstance || currentRenderingInstance;
      var internalSetCurrentInstance;
      var setInSSRSetupState;
      {
        const g = shared.getGlobalThis();
        const registerGlobalSetter = (key, setter) => {
          let setters;
          if (!(setters = g[key])) setters = g[key] = [];
          setters.push(setter);
          return (v) => {
            if (setters.length > 1) setters.forEach((set) => set(v));
            else setters[0](v);
          };
        };
        internalSetCurrentInstance = registerGlobalSetter(
          `__VUE_INSTANCE_SETTERS__`,
          (v) => currentInstance = v
        );
        setInSSRSetupState = registerGlobalSetter(
          `__VUE_SSR_SETTERS__`,
          (v) => isInSSRComponentSetup = v
        );
      }
      var setCurrentInstance = (instance) => {
        const prev = currentInstance;
        internalSetCurrentInstance(instance);
        instance.scope.on();
        return () => {
          instance.scope.off();
          internalSetCurrentInstance(prev);
        };
      };
      var unsetCurrentInstance = () => {
        currentInstance && currentInstance.scope.off();
        internalSetCurrentInstance(null);
      };
      function isStatefulComponent(instance) {
        return instance.vnode.shapeFlag & 4;
      }
      var isInSSRComponentSetup = false;
      function setupComponent(instance, isSSR = false, optimized = false) {
        isSSR && setInSSRSetupState(isSSR);
        const { props, children } = instance.vnode;
        const isStateful = isStatefulComponent(instance);
        initProps(instance, props, isStateful, isSSR);
        initSlots(instance, children, optimized || isSSR);
        const setupResult = isStateful ? setupStatefulComponent(instance, isSSR) : void 0;
        isSSR && setInSSRSetupState(false);
        return setupResult;
      }
      function setupStatefulComponent(instance, isSSR) {
        const Component = instance.type;
        instance.accessCache = /* @__PURE__ */ Object.create(null);
        instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers);
        const { setup } = Component;
        if (setup) {
          reactivity.pauseTracking();
          const setupContext = instance.setupContext = setup.length > 1 ? createSetupContext(instance) : null;
          const reset = setCurrentInstance(instance);
          const setupResult = callWithErrorHandling(
            setup,
            instance,
            0,
            [
              instance.props,
              setupContext
            ]
          );
          const isAsyncSetup = shared.isPromise(setupResult);
          reactivity.resetTracking();
          reset();
          if ((isAsyncSetup || instance.sp) && !isAsyncWrapper(instance)) {
            markAsyncBoundary(instance);
          }
          if (isAsyncSetup) {
            setupResult.then(unsetCurrentInstance, unsetCurrentInstance);
            if (isSSR) {
              return setupResult.then((resolvedResult) => {
                setInSSRSetupState(true);
                try {
                  handleSetupResult(instance, resolvedResult, isSSR);
                } finally {
                  setInSSRSetupState(false);
                }
              }).catch((e) => {
                handleError(e, instance, 0);
              });
            } else {
              instance.asyncDep = setupResult;
            }
          } else {
            handleSetupResult(instance, setupResult, isSSR);
          }
        } else {
          finishComponentSetup(instance, isSSR);
        }
      }
      function handleSetupResult(instance, setupResult, isSSR) {
        if (shared.isFunction(setupResult)) {
          if (instance.type.__ssrInlineRender) {
            instance.ssrRender = setupResult;
          } else {
            instance.render = setupResult;
          }
        } else if (shared.isObject(setupResult)) {
          instance.setupState = reactivity.proxyRefs(setupResult);
        } else ;
        finishComponentSetup(instance, isSSR);
      }
      var compile;
      var installWithProxy;
      function registerRuntimeCompiler(_compile) {
        compile = _compile;
        installWithProxy = (i) => {
          if (i.render._rc) {
            i.withProxy = new Proxy(i.ctx, RuntimeCompiledPublicInstanceProxyHandlers);
          }
        };
      }
      var isRuntimeOnly = () => !compile;
      function finishComponentSetup(instance, isSSR, skipOptions) {
        const Component = instance.type;
        if (!instance.render) {
          if (!isSSR && compile && !Component.render) {
            const template = Component.template || resolveMergedOptions(instance).template;
            if (template) {
              const { isCustomElement, compilerOptions } = instance.appContext.config;
              const { delimiters, compilerOptions: componentCompilerOptions } = Component;
              const finalCompilerOptions = shared.extend(
                shared.extend(
                  {
                    isCustomElement,
                    delimiters
                  },
                  compilerOptions
                ),
                componentCompilerOptions
              );
              Component.render = compile(template, finalCompilerOptions);
            }
          }
          instance.render = Component.render || shared.NOOP;
          if (installWithProxy) {
            installWithProxy(instance);
          }
        }
        {
          const reset = setCurrentInstance(instance);
          reactivity.pauseTracking();
          try {
            applyOptions(instance);
          } finally {
            reactivity.resetTracking();
            reset();
          }
        }
      }
      var attrsProxyHandlers = {
        get(target, key) {
          reactivity.track(target, "get", "");
          return target[key];
        }
      };
      function createSetupContext(instance) {
        const expose = (exposed) => {
          instance.exposed = exposed || {};
        };
        {
          return {
            attrs: new Proxy(instance.attrs, attrsProxyHandlers),
            slots: instance.slots,
            emit: instance.emit,
            expose
          };
        }
      }
      function getComponentPublicInstance(instance) {
        if (instance.exposed) {
          return instance.exposeProxy || (instance.exposeProxy = new Proxy(reactivity.proxyRefs(reactivity.markRaw(instance.exposed)), {
            get(target, key) {
              if (key in target) {
                return target[key];
              } else if (key in publicPropertiesMap) {
                return publicPropertiesMap[key](instance);
              }
            },
            has(target, key) {
              return key in target || key in publicPropertiesMap;
            }
          }));
        } else {
          return instance.proxy;
        }
      }
      function getComponentName(Component, includeInferred = true) {
        return shared.isFunction(Component) ? Component.displayName || Component.name : Component.name || includeInferred && Component.__name;
      }
      function isClassComponent(value) {
        return shared.isFunction(value) && "__vccOpts" in value;
      }
      var computed = (getterOrOptions, debugOptions) => {
        const c = reactivity.computed(getterOrOptions, debugOptions, isInSSRComponentSetup);
        return c;
      };
      function h(type, propsOrChildren, children) {
        try {
          setBlockTracking(-1);
          const l = arguments.length;
          if (l === 2) {
            if (shared.isObject(propsOrChildren) && !shared.isArray(propsOrChildren)) {
              if (isVNode(propsOrChildren)) {
                return createVNode(type, null, [propsOrChildren]);
              }
              return createVNode(type, propsOrChildren);
            } else {
              return createVNode(type, null, propsOrChildren);
            }
          } else {
            if (l > 3) {
              children = Array.prototype.slice.call(arguments, 2);
            } else if (l === 3 && isVNode(children)) {
              children = [children];
            }
            return createVNode(type, propsOrChildren, children);
          }
        } finally {
          setBlockTracking(1);
        }
      }
      function initCustomFormatter() {
        {
          return;
        }
      }
      function withMemo(memo, render2, cache, index) {
        const cached = cache[index];
        if (cached && isMemoSame(cached, memo)) {
          return cached;
        }
        const ret = render2();
        ret.memo = memo.slice();
        ret.cacheIndex = index;
        return cache[index] = ret;
      }
      function isMemoSame(cached, memo) {
        const prev = cached.memo;
        if (prev.length != memo.length) {
          return false;
        }
        for (let i = 0; i < prev.length; i++) {
          if (shared.hasChanged(prev[i], memo[i])) {
            return false;
          }
        }
        if (isBlockTreeEnabled > 0 && currentBlock) {
          currentBlock.push(cached);
        }
        return true;
      }
      var version = "3.5.42";
      var warn$1 = shared.NOOP;
      var ErrorTypeStrings = ErrorTypeStrings$1;
      var devtools = void 0;
      var setDevtoolsHook = shared.NOOP;
      var _ssrUtils = {
        createComponentInstance,
        setupComponent,
        renderComponentRoot,
        setCurrentRenderingInstance,
        isVNode,
        normalizeVNode,
        getComponentPublicInstance,
        ensureValidVNode,
        pushWarningContext,
        popWarningContext
      };
      var ssrUtils = _ssrUtils;
      var resolveFilter = null;
      var compatUtils = null;
      var DeprecationTypes = null;
      exports.EffectScope = reactivity.EffectScope;
      exports.ReactiveEffect = reactivity.ReactiveEffect;
      exports.TrackOpTypes = reactivity.TrackOpTypes;
      exports.TriggerOpTypes = reactivity.TriggerOpTypes;
      exports.customRef = reactivity.customRef;
      exports.effect = reactivity.effect;
      exports.effectScope = reactivity.effectScope;
      exports.getCurrentScope = reactivity.getCurrentScope;
      exports.getCurrentWatcher = reactivity.getCurrentWatcher;
      exports.isProxy = reactivity.isProxy;
      exports.isReactive = reactivity.isReactive;
      exports.isReadonly = reactivity.isReadonly;
      exports.isRef = reactivity.isRef;
      exports.isShallow = reactivity.isShallow;
      exports.markRaw = reactivity.markRaw;
      exports.onScopeDispose = reactivity.onScopeDispose;
      exports.onWatcherCleanup = reactivity.onWatcherCleanup;
      exports.proxyRefs = reactivity.proxyRefs;
      exports.reactive = reactivity.reactive;
      exports.readonly = reactivity.readonly;
      exports.ref = reactivity.ref;
      exports.shallowReactive = reactivity.shallowReactive;
      exports.shallowReadonly = reactivity.shallowReadonly;
      exports.shallowRef = reactivity.shallowRef;
      exports.stop = reactivity.stop;
      exports.toRaw = reactivity.toRaw;
      exports.toRef = reactivity.toRef;
      exports.toRefs = reactivity.toRefs;
      exports.toValue = reactivity.toValue;
      exports.triggerRef = reactivity.triggerRef;
      exports.unref = reactivity.unref;
      exports.camelize = shared.camelize;
      exports.capitalize = shared.capitalize;
      exports.normalizeClass = shared.normalizeClass;
      exports.normalizeProps = shared.normalizeProps;
      exports.normalizeStyle = shared.normalizeStyle;
      exports.toDisplayString = shared.toDisplayString;
      exports.toHandlerKey = shared.toHandlerKey;
      exports.BaseTransition = BaseTransition;
      exports.BaseTransitionPropsValidators = BaseTransitionPropsValidators;
      exports.Comment = Comment;
      exports.DeprecationTypes = DeprecationTypes;
      exports.ErrorCodes = ErrorCodes;
      exports.ErrorTypeStrings = ErrorTypeStrings;
      exports.Fragment = Fragment;
      exports.KeepAlive = KeepAlive;
      exports.Static = Static;
      exports.Suspense = Suspense;
      exports.Teleport = Teleport;
      exports.Text = Text;
      exports.assertNumber = assertNumber;
      exports.callWithAsyncErrorHandling = callWithAsyncErrorHandling;
      exports.callWithErrorHandling = callWithErrorHandling;
      exports.cloneVNode = cloneVNode;
      exports.compatUtils = compatUtils;
      exports.computed = computed;
      exports.createBlock = createBlock;
      exports.createCommentVNode = createCommentVNode;
      exports.createElementBlock = createElementBlock;
      exports.createElementVNode = createBaseVNode;
      exports.createHydrationRenderer = createHydrationRenderer;
      exports.createPropsRestProxy = createPropsRestProxy;
      exports.createRenderer = createRenderer2;
      exports.createSlots = createSlots;
      exports.createStaticVNode = createStaticVNode;
      exports.createTextVNode = createTextVNode;
      exports.createVNode = createVNode;
      exports.defineAsyncComponent = defineAsyncComponent;
      exports.defineComponent = defineComponent;
      exports.defineEmits = defineEmits;
      exports.defineExpose = defineExpose;
      exports.defineModel = defineModel;
      exports.defineOptions = defineOptions;
      exports.defineProps = defineProps;
      exports.defineSlots = defineSlots;
      exports.devtools = devtools;
      exports.getCurrentInstance = getCurrentInstance2;
      exports.getTransitionRawChildren = getTransitionRawChildren;
      exports.guardReactiveProps = guardReactiveProps;
      exports.h = h;
      exports.handleError = handleError;
      exports.hasInjectionContext = hasInjectionContext;
      exports.hydrateOnIdle = hydrateOnIdle;
      exports.hydrateOnInteraction = hydrateOnInteraction;
      exports.hydrateOnMediaQuery = hydrateOnMediaQuery;
      exports.hydrateOnVisible = hydrateOnVisible;
      exports.initCustomFormatter = initCustomFormatter;
      exports.inject = inject;
      exports.isMemoSame = isMemoSame;
      exports.isRuntimeOnly = isRuntimeOnly;
      exports.isVNode = isVNode;
      exports.mergeDefaults = mergeDefaults;
      exports.mergeModels = mergeModels;
      exports.mergeProps = mergeProps;
      exports.nextTick = nextTick;
      exports.onActivated = onActivated;
      exports.onBeforeMount = onBeforeMount;
      exports.onBeforeUnmount = onBeforeUnmount;
      exports.onBeforeUpdate = onBeforeUpdate;
      exports.onDeactivated = onDeactivated;
      exports.onErrorCaptured = onErrorCaptured;
      exports.onMounted = onMounted;
      exports.onRenderTracked = onRenderTracked;
      exports.onRenderTriggered = onRenderTriggered;
      exports.onServerPrefetch = onServerPrefetch;
      exports.onUnmounted = onUnmounted;
      exports.onUpdated = onUpdated;
      exports.openBlock = openBlock;
      exports.popScopeId = popScopeId;
      exports.provide = provide;
      exports.pushScopeId = pushScopeId;
      exports.queuePostFlushCb = queuePostFlushCb;
      exports.registerRuntimeCompiler = registerRuntimeCompiler;
      exports.renderList = renderList;
      exports.renderSlot = renderSlot;
      exports.resolveComponent = resolveComponent;
      exports.resolveDirective = resolveDirective;
      exports.resolveDynamicComponent = resolveDynamicComponent;
      exports.resolveFilter = resolveFilter;
      exports.resolveTransitionHooks = resolveTransitionHooks;
      exports.setBlockTracking = setBlockTracking;
      exports.setDevtoolsHook = setDevtoolsHook;
      exports.setTransitionHooks = setTransitionHooks;
      exports.ssrContextKey = ssrContextKey;
      exports.ssrUtils = ssrUtils;
      exports.toHandlers = toHandlers;
      exports.transformVNodeArgs = transformVNodeArgs;
      exports.useAttrs = useAttrs;
      exports.useId = useId;
      exports.useModel = useModel;
      exports.useSSRContext = useSSRContext;
      exports.useSlots = useSlots;
      exports.useTemplateRef = useTemplateRef;
      exports.useTransitionState = useTransitionState;
      exports.version = version;
      exports.warn = warn$1;
      exports.watch = watch;
      exports.watchEffect = watchEffect;
      exports.watchPostEffect = watchPostEffect;
      exports.watchSyncEffect = watchSyncEffect;
      exports.withAsyncContext = withAsyncContext;
      exports.withCtx = withCtx;
      exports.withDefaults = withDefaults;
      exports.withDirectives = withDirectives;
      exports.withMemo = withMemo;
      exports.withScopeId = withScopeId;
    }
  });

  // node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/index.js
  var require_runtime_core = __commonJS({
    "node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/index.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_runtime_core_cjs_prod();
      } else {
        module.exports = null;
      }
    }
  });

  // packages/slot-runtime/src/opcode.ts
  var PropKeyTable = class _PropKeyTable {
    constructor() {
      this.keys = [];
      this.index = /* @__PURE__ */ new Map();
    }
    /** 分配（已存在则返回原下标——**幂等**） */
    intern(key) {
      const hit = this.index.get(key);
      if (hit !== void 0) return hit;
      const id = this.keys.length;
      this.keys.push(key);
      this.index.set(key, id);
      return id;
    }
    /** 反查（诊断 / explain 用；运行时不走这条路径） */
    keyOf(id) {
      return this.keys[id];
    }
    get size() {
      return this.keys.length;
    }
    /** 导出（进 PatchTable 产物） */
    toArray() {
      return [...this.keys];
    }
    /** 导入（消费方重建） */
    static fromArray(keys) {
      const t = new _PropKeyTable();
      for (const k of keys) t.intern(k);
      return t;
    }
  };
  var StringPool = class _StringPool {
    constructor() {
      this.values = [];
      this.index = /* @__PURE__ */ new Map();
    }
    intern(s) {
      const hit = this.index.get(s);
      if (hit !== void 0) return hit;
      const id = this.values.length;
      this.values.push(s);
      this.index.set(s, id);
      return id;
    }
    valueOf(id) {
      return this.values[id];
    }
    get size() {
      return this.values.length;
    }
    toArray() {
      return [...this.values];
    }
    static fromArray(values) {
      const p = new _StringPool();
      for (const v of values) p.intern(v);
      return p;
    }
  };

  // packages/slot-runtime/src/anim-curve.ts
  var AnimCurve = {
    LINEAR: 0,
    EASE_OUT_CUBIC: 1,
    EASE_IN_CUBIC: 2,
    EASE_IN_OUT_CUBIC: 3,
    SPRING_APPROX: 4
  };
  var TABLE_N = 65;
  function springApprox(u) {
    return 1 - Math.exp(-6 * u) * Math.cos(10 * u);
  }
  function buildTable(curve) {
    const t = new Float64Array(TABLE_N);
    for (let i = 0; i < TABLE_N; i++) {
      const u = i / (TABLE_N - 1);
      t[i] = curve === AnimCurve.EASE_OUT_CUBIC ? 1 - (1 - u) ** 3 : curve === AnimCurve.EASE_IN_CUBIC ? u ** 3 : curve === AnimCurve.EASE_IN_OUT_CUBIC ? u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2 : curve === AnimCurve.SPRING_APPROX ? springApprox(u) : u;
    }
    t[0] = 0;
    t[TABLE_N - 1] = 1;
    return t;
  }
  var TABLES = [
    buildTable(AnimCurve.LINEAR),
    buildTable(AnimCurve.EASE_OUT_CUBIC),
    buildTable(AnimCurve.EASE_IN_CUBIC),
    buildTable(AnimCurve.EASE_IN_OUT_CUBIC),
    buildTable(AnimCurve.SPRING_APPROX)
  ];

  // packages/slot-runtime/src/buffer.ts
  var OPS_MAGIC = 1347376720;
  var OPS_VERSION = 2;
  var OPS_HEADER_BYTES = 20;
  function opSize(op) {
    switch (op.op) {
      case 1 /* SET_PROP */:
      case 2 /* SET_STYLE */:
        return 11;
      case 3 /* SET_TEXT */:
        return 9;
      case 4 /* SET_ATTRS */:
        return 7 + 6 * op.attrs.length;
      case 5 /* TOGGLE_VIS */:
        return 6;
      case 16 /* INSERT_BLOCK */:
        return 10;
      case 17 /* REMOVE_NODE */:
        return 5;
      case 18 /* MOVE_NODE */:
        return 10;
      case 32 /* LIST_SET */:
        return 9;
      case 33 /* LIST_SPLICE */:
        return 15 + 4 * op.itemKeyRefs.length;
      case 34 /* LIST_UPDATE */:
        return 17;
      case 48 /* CALL_COMPONENT_UPDATE */:
        return 13;
      default: {
        const never = op;
        throw new Error(`\u672A\u77E5\u6307\u4EE4\uFF1A${JSON.stringify(never)}`);
      }
    }
  }
  var ByteWriter = class {
    constructor(size) {
      this.pos = 0;
      this.buf = new Uint8Array(size);
    }
    u8(v) {
      this.buf[this.pos++] = v & 255;
    }
    u16(v) {
      this.buf[this.pos++] = v & 255;
      this.buf[this.pos++] = v >>> 8 & 255;
    }
    u32(v) {
      this.buf[this.pos++] = v & 255;
      this.buf[this.pos++] = v >>> 8 & 255;
      this.buf[this.pos++] = v >>> 16 & 255;
      this.buf[this.pos++] = v >>> 24 & 255;
    }
    f32(v) {
      const f = new Float32Array(1);
      f[0] = v;
      const b = new Uint8Array(f.buffer);
      this.buf[this.pos++] = b[0];
      this.buf[this.pos++] = b[1];
      this.buf[this.pos++] = b[2];
      this.buf[this.pos++] = b[3];
    }
    str(s) {
      const bytes = utf8Encode(s);
      if (bytes.length > 65535) throw new Error(`\u5B57\u7B26\u4E32\u8FC7\u957F\uFF08>65535B\uFF09\uFF1A${bytes.length}`);
      this.u16(bytes.length);
      this.buf.set(bytes, this.pos);
      this.pos += bytes.length;
    }
    done() {
      if (this.pos !== this.buf.length) throw new Error(`\u5199\u5165\u957F\u5EA6\u4E0D\u7B26\uFF1A${this.pos} != ${this.buf.length}`);
      return this.buf;
    }
  };
  var ByteReader = class {
    constructor(buf) {
      this.buf = buf;
      this.pos = 0;
    }
    get offset() {
      return this.pos;
    }
    get remaining() {
      return this.buf.length - this.pos;
    }
    u8() {
      if (this.remaining < 1) throw new Error("\u6307\u4EE4\u6D41\u88AB\u622A\u65AD\uFF08u8\uFF09");
      return this.buf[this.pos++];
    }
    u16() {
      if (this.remaining < 2) throw new Error("\u6307\u4EE4\u6D41\u88AB\u622A\u65AD\uFF08u16\uFF09");
      const v = this.buf[this.pos] | this.buf[this.pos + 1] << 8;
      this.pos += 2;
      return v;
    }
    u32() {
      if (this.remaining < 4) throw new Error("\u6307\u4EE4\u6D41\u88AB\u622A\u65AD\uFF08u32\uFF09");
      const v = (this.buf[this.pos] | this.buf[this.pos + 1] << 8 | this.buf[this.pos + 2] << 16 | this.buf[this.pos + 3] << 24) >>> 0;
      this.pos += 4;
      return v;
    }
    f32() {
      if (this.remaining < 4) throw new Error("\u6307\u4EE4\u6D41\u88AB\u622A\u65AD\uFF08f32\uFF09");
      const b = this.buf.subarray(this.pos, this.pos + 4);
      this.pos += 4;
      return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + 4))[0];
    }
    str() {
      const len = this.u16();
      if (this.remaining < len) throw new Error("\u6307\u4EE4\u6D41\u88AB\u622A\u65AD\uFF08str\uFF09");
      const s = utf8Decode(this.buf.subarray(this.pos, this.pos + len));
      this.pos += len;
      return s;
    }
  };
  function utf8Encode(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let cp = s.charCodeAt(i);
      if (cp >= 55296 && cp <= 56319 && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 56320 && lo <= 57343) {
          cp = (cp - 55296 << 10) + (lo - 56320) + 65536;
          i++;
        }
      }
      if (cp < 128) out.push(cp);
      else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
      else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
      else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
    }
    return Uint8Array.from(out);
  }
  function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i];
      let cp;
      let need;
      if (b0 < 128) {
        cp = b0;
        need = 0;
      } else if ((b0 & 224) === 192) {
        cp = b0 & 31;
        need = 1;
      } else if ((b0 & 240) === 224) {
        cp = b0 & 15;
        need = 2;
      } else if ((b0 & 248) === 240) {
        cp = b0 & 7;
        need = 3;
      } else {
        throw new Error(`\u975E\u6CD5 UTF-8 \u9996\u5B57\u8282\uFF1A0x${b0.toString(16)} @${i}`);
      }
      if (i + need >= bytes.length) throw new Error(`UTF-8 \u622A\u65AD @${i}`);
      for (let k = 1; k <= need; k++) {
        const bn = bytes[i + k];
        if ((bn & 192) !== 128) throw new Error(`\u975E\u6CD5 UTF-8 \u7EED\u5B57\u8282\uFF1A0x${bn.toString(16)} @${i + k}`);
        cp = cp << 6 | bn & 63;
      }
      i += need + 1;
      if (cp > 65535) {
        cp -= 65536;
        out += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }
  var OpBuffer = class {
    constructor() {
      this.ops = [];
    }
    push(op) {
      this.ops.push(op);
    }
    get count() {
      return this.ops.length;
    }
    /** 只读快照（调试 / explain / 测试用） */
    snapshot() {
      return this.ops.slice();
    }
    clear() {
      this.ops.length = 0;
    }
    /**
     * 编码并提交，随后**清空**。
     *
     * @param keys    属性键表（进入 Header，供消费方还原 keyId → 字符串）
     * @param strings 字符串池（同上）
     * @param sink    提交出口（App 端 = 一次 JSI 调用）
     * @returns 本次提交的字节数
     */
    flush(keys, strings, sink) {
      const bytes = encodeOps(this.ops, keys, strings);
      const n = this.ops.length;
      sink(bytes, n);
      this.ops.length = 0;
      return bytes.length;
    }
  };
  function collectRefs(ops) {
    const k = /* @__PURE__ */ new Set();
    const s = /* @__PURE__ */ new Set();
    for (const op of ops) {
      switch (op.op) {
        case 1 /* SET_PROP */:
        case 2 /* SET_STYLE */:
          k.add(op.keyId);
          break;
        case 4 /* SET_ATTRS */:
          for (const a of op.attrs) k.add(a.keyId);
          break;
        case 3 /* SET_TEXT */:
          s.add(op.textRef);
          break;
        case 33 /* LIST_SPLICE */:
          for (const r of op.itemKeyRefs) s.add(r);
          break;
        case 34 /* LIST_UPDATE */:
          s.add(op.itemKeyRef);
          break;
        // TOGGLE_VIS / INSERT_BLOCK / REMOVE_NODE / MOVE_NODE / LIST_SET /
        // CALL_COMPONENT_UPDATE：无池引用（若将来新增，**在此处补一支**）
        default:
          break;
      }
    }
    return { keyIds: [...k].sort((a, b) => a - b), strRefs: [...s].sort((a, b) => a - b) };
  }
  function remapOf(used) {
    const m = /* @__PURE__ */ new Map();
    used.forEach((old, i) => m.set(old, i));
    return m;
  }
  function remapOp(op, kMap, sMap) {
    switch (op.op) {
      case 1 /* SET_PROP */:
      case 2 /* SET_STYLE */:
        return { ...op, keyId: kMap.get(op.keyId) ?? 0 };
      case 4 /* SET_ATTRS */:
        return { ...op, attrs: op.attrs.map((a) => ({ keyId: kMap.get(a.keyId) ?? 0, value: a.value })) };
      case 3 /* SET_TEXT */:
        return { ...op, textRef: sMap.get(op.textRef) ?? 0 };
      case 33 /* LIST_SPLICE */:
        return { ...op, itemKeyRefs: op.itemKeyRefs.map((r) => sMap.get(r) ?? 0) };
      case 34 /* LIST_UPDATE */:
        return { ...op, itemKeyRef: sMap.get(op.itemKeyRef) ?? 0 };
      default:
        return op;
    }
  }
  function encodeOps(ops, keys, strings) {
    const allKeys = keys.toArray();
    const allStrs = strings.toArray();
    const used = collectRefs(ops);
    const keyArr = used.keyIds.map((i) => allKeys[i]).filter((x) => x !== void 0);
    const strArr = used.strRefs.map((i) => allStrs[i]).filter((x) => x !== void 0);
    const kMap = remapOf(used.keyIds.filter((i) => allKeys[i] !== void 0));
    const sMap = remapOf(used.strRefs.filter((i) => allStrs[i] !== void 0));
    let size = OPS_HEADER_BYTES;
    for (const k of keyArr) size += 2 + utf8Encode(k).length;
    for (const s of strArr) size += 2 + utf8Encode(s).length;
    for (const op of ops) size += opSize(op);
    const w = new ByteWriter(size);
    w.u32(OPS_MAGIC);
    w.u32(OPS_VERSION);
    w.u32(ops.length);
    w.u32(keyArr.length);
    w.u32(strArr.length);
    for (const k of keyArr) w.str(k);
    for (const s of strArr) w.str(s);
    for (const op of ops) encodeOp(w, remapOp(op, kMap, sMap));
    return w.done();
  }
  function encodeOp(w, op) {
    w.u8(op.op);
    switch (op.op) {
      case 1 /* SET_PROP */:
      case 2 /* SET_STYLE */:
        w.u32(op.nodeId);
        w.u16(op.keyId);
        w.f32(op.value);
        return;
      case 3 /* SET_TEXT */:
        w.u32(op.nodeId);
        w.u32(op.textRef);
        return;
      case 4 /* SET_ATTRS */:
        w.u32(op.nodeId);
        w.u16(op.attrs.length);
        for (const a of op.attrs) {
          w.u16(a.keyId);
          w.f32(a.value);
        }
        return;
      case 5 /* TOGGLE_VIS */:
        w.u32(op.nodeId);
        w.u8(op.visible ? 1 : 0);
        return;
      case 16 /* INSERT_BLOCK */:
        w.u32(op.blockId);
        w.u32(op.refNodeId);
        w.u8(op.pos);
        return;
      case 17 /* REMOVE_NODE */:
        w.u32(op.nodeId);
        return;
      case 18 /* MOVE_NODE */:
        w.u32(op.nodeId);
        w.u32(op.refNodeId);
        w.u8(op.pos);
        return;
      case 32 /* LIST_SET */:
        w.u32(op.listId);
        w.u32(op.dataRef);
        return;
      case 33 /* LIST_SPLICE */:
        w.u32(op.listId);
        w.u32(op.start);
        w.u32(op.delCount);
        w.u16(op.itemKeyRefs.length);
        for (const r of op.itemKeyRefs) w.u32(r);
        return;
      case 34 /* LIST_UPDATE */:
        w.u32(op.listId);
        w.u32(op.itemKeyRef);
        w.u32(op.slotId);
        w.f32(op.value);
        return;
      case 48 /* CALL_COMPONENT_UPDATE */:
        w.u32(op.componentId);
        w.u32(op.slotId);
        w.f32(op.value);
        return;
      default: {
        const never = op;
        throw new Error(`\u672A\u77E5\u6307\u4EE4\uFF1A${JSON.stringify(never)}`);
      }
    }
  }
  function decodeOps(bytes) {
    const r = new ByteReader(bytes);
    const magic = r.u32();
    if (magic !== OPS_MAGIC) throw new Error(`magic \u4E0D\u7B26\uFF1A0x${magic.toString(16)}\uFF08\u671F\u671B 0x${OPS_MAGIC.toString(16)}\uFF09`);
    const version = r.u32();
    if (version !== OPS_VERSION) throw new Error(`\u7248\u672C\u4E0D\u7B26\uFF1A${version}\uFF08\u671F\u671B ${OPS_VERSION}\uFF09`);
    const opCount = r.u32();
    const keyCount = r.u32();
    const strCount = r.u32();
    const keys = new PropKeyTable();
    for (let i = 0; i < keyCount; i++) keys.intern(r.str());
    const strings = new StringPool();
    for (let i = 0; i < strCount; i++) strings.intern(r.str());
    const ops = [];
    for (let i = 0; i < opCount; i++) ops.push(decodeOp(r));
    if (r.remaining !== 0) throw new Error(`\u6307\u4EE4\u6D41\u5C3E\u90E8\u6709 ${r.remaining} \u5B57\u8282\u6B8B\u7559\uFF08\u683C\u5F0F\u6216\u8BA1\u6570\u4E0D\u7B26\uFF09`);
    return { version, ops, keys, strings };
  }
  function decodeOp(r) {
    const op = r.u8();
    switch (op) {
      case 1 /* SET_PROP */:
      case 2 /* SET_STYLE */:
        return { op, nodeId: r.u32(), keyId: r.u16(), value: r.f32() };
      case 3 /* SET_TEXT */:
        return { op, nodeId: r.u32(), textRef: r.u32() };
      case 4 /* SET_ATTRS */: {
        const nodeId = r.u32();
        const n = r.u16();
        const attrs = [];
        for (let i = 0; i < n; i++) attrs.push({ keyId: r.u16(), value: r.f32() });
        return { op, nodeId, attrs };
      }
      case 5 /* TOGGLE_VIS */:
        return { op, nodeId: r.u32(), visible: r.u8() !== 0 };
      case 16 /* INSERT_BLOCK */:
        return { op, blockId: r.u32(), refNodeId: r.u32(), pos: r.u8() };
      case 17 /* REMOVE_NODE */:
        return { op, nodeId: r.u32() };
      case 18 /* MOVE_NODE */:
        return { op, nodeId: r.u32(), refNodeId: r.u32(), pos: r.u8() };
      case 32 /* LIST_SET */:
        return { op, listId: r.u32(), dataRef: r.u32() };
      case 33 /* LIST_SPLICE */: {
        const listId = r.u32();
        const start = r.u32();
        const delCount = r.u32();
        const n = r.u16();
        const itemKeyRefs = [];
        for (let i = 0; i < n; i++) itemKeyRefs.push(r.u32());
        return { op, listId, start, delCount, itemKeyRefs };
      }
      case 34 /* LIST_UPDATE */:
        return { op, listId: r.u32(), itemKeyRef: r.u32(), slotId: r.u32(), value: r.f32() };
      case 48 /* CALL_COMPONENT_UPDATE */:
        return { op, componentId: r.u32(), slotId: r.u32(), value: r.f32() };
      default:
        throw new Error(`\u672A\u77E5\u64CD\u4F5C\u7801\uFF1A0x${op.toString(16)}\uFF08\u6E38\u6807\u4F4D\u7F6E ${r.offset}\uFF09`);
    }
  }

  // packages/slot-runtime/src/slot.ts
  function createSlot(spec, keys, strings, initial, registry) {
    const nodeId = spec.nodeId;
    const keyId = spec.keyId ?? 0;
    const listId = spec.listId ?? 0;
    const listSlotId = spec.listSlotId ?? spec.id;
    const slot = {
      id: spec.id,
      nodeId,
      kind: spec.kind,
      value: initial,
      dirty: false,
      emit(next, buf) {
        switch (spec.kind) {
          case "text":
            buf.push({ op: 3 /* SET_TEXT */, nodeId, textRef: strings.intern(String(next)) });
            return;
          case "prop":
            buf.push({ op: 1 /* SET_PROP */, nodeId, keyId, value: toF32(next) });
            return;
          case "style":
            buf.push({ op: 2 /* SET_STYLE */, nodeId, keyId, value: toF32(next) });
            return;
          case "visibility":
            buf.push({ op: 5 /* TOGGLE_VIS */, nodeId, visible: Boolean(next) });
            return;
          case "list-item": {
            const item = next;
            const nodeId2 = registry?.resolveNode(listId, item.key, listSlotId);
            if (nodeId2 !== void 0) {
              if ((spec.itemKind ?? "style") === "text") {
                buf.push({ op: 3 /* SET_TEXT */, nodeId: nodeId2, textRef: strings.intern(String(item.value)) });
              } else {
                buf.push({ op: 2 /* SET_STYLE */, nodeId: nodeId2, keyId, value: toF32(item.value) });
              }
              return;
            }
            buf.push({
              op: 34 /* LIST_UPDATE */,
              listId,
              itemKeyRef: strings.intern(item.key),
              slotId: listSlotId,
              value: toF32(item.value)
            });
            return;
          }
          case "list-data":
            buf.push({ op: 32 /* LIST_SET */, listId, dataRef: toF32(next) });
            return;
          case "attrs": {
            const attrs = next;
            buf.push({ op: 4 /* SET_ATTRS */, nodeId, attrs });
            return;
          }
          case "component-prop":
            buf.push({ op: 48 /* CALL_COMPONENT_UPDATE */, componentId: nodeId, slotId: listSlotId, value: toF32(next) });
            return;
          default: {
            const never = spec.kind;
            throw new Error(`\u672A\u77E5\u69FD\u4F4D\u79CD\u7C7B\uFF1A${String(never)}`);
          }
        }
      }
    };
    return slot;
  }
  function toF32(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    throw new Error(`\u69FD\u4F4D\u503C\u5FC5\u987B\u662F number/boolean\uFF0C\u6536\u5230 ${typeof v}\uFF08\u6587\u672C\u8BF7\u7528 kind='text'\uFF09`);
  }
  var microtaskScheduler = {
    schedule(cb) {
      void Promise.resolve().then(cb);
    }
  };
  var SlotRuntime = class {
    constructor(keys, strings, sink, scheduler = microtaskScheduler) {
      this.keys = keys;
      this.strings = strings;
      this.sink = sink;
      this.scheduler = scheduler;
      this.buffer = new OpBuffer();
      this.dirty = [];
      this.pending = false;
      this.stats = { flushes: 0, opsEmitted: 0, bytesSent: 0, shortCircuits: 0 };
      /**
       * ★★**帧号**（P2-5 新增）：每次 `flush()` 调用（**包括无脏槽位的空调用**）自增。
       *
       * 【为什么需要（v-memo 的组语义要求帧边界）】memo 组在"同一帧内"只判定一次脏：
       *   若一帧里有多个源变化（多次 `writeSlotsOfSource`）触到同一组的多个槽位，
       *   第一次判定"依赖变了"之后，同帧其余槽位必须**照常写**（组语义 = 子树整体更新）。
       *   而判定一次的判据只有帧边界——`flush()` 是这套系统的天然帧边界。
       *   ★与 `stats.flushes` 的区别：后者只在**真的提交了字节**时自增（空 flush 不计）；
       *     本计数每次 flush 调用都自增（帧边界语义）。
       */
      this.frame = 0;
    }
    /** 帧号（v-memo 门用；只读） */
    get frameId() {
      return this.frame;
    }
    /** 槽位写入（方案 §3.3）：相等即短路；否则标脏 + 排帧 */
    setSlot(slot, next) {
      if (Object.is(slot.value, next)) {
        this.stats.shortCircuits++;
        return;
      }
      slot.value = next;
      if (!slot.dirty) {
        slot.dirty = true;
        this.dirty.push(slot);
      }
      this.scheduleFlush();
    }
    /** 排帧（幂等——同帧多次调用只排一次） */
    scheduleFlush() {
      if (this.pending) return;
      this.pending = true;
      this.scheduler.schedule(() => this.flush());
    }
    /**
     * 立即 flush（测试 / 确定性驱动用）
     *
     * 【为什么单独暴露】真机上「Vsync 何时来」不可控；测量装置纪律要求用例能**确定性地**
     *   驱动一次提交（本仓四次踩过"测量装置污染读数"）。
     */
    flush() {
      this.frame++;
      this.pending = false;
      for (const slot of this.dirty) {
        slot.emit(slot.value, this.buffer);
        slot.dirty = false;
      }
      this.dirty.length = 0;
      if (this.buffer.count === 0) return;
      this.stats.opsEmitted += this.buffer.count;
      this.stats.bytesSent += this.buffer.flush(this.keys, this.strings, this.sink);
      this.stats.flushes++;
    }
    getStats() {
      return { ...this.stats };
    }
    /** 待发射的脏槽位数（诊断） */
    get dirtyCount() {
      return this.dirty.length;
    }
  };

  // packages/slot-runtime/src/table.ts
  function resolveDynamicClasses(classValue, rules) {
    const active = collectActiveClasses(classValue);
    if (active.size === 0 || rules.length === 0) return {};
    const normal = {};
    const important = {};
    for (const r of rules) {
      if (r.classes.length === 0) continue;
      if (!r.classes.every((c) => active.has(c))) continue;
      for (const [k, v] of Object.entries(r.decls)) {
        if (r.important.includes(k)) important[k] = v;
        else normal[k] = v;
      }
    }
    return { ...normal, ...important };
  }
  function collectActiveClasses(v) {
    const out = /* @__PURE__ */ new Set();
    const walk = (x) => {
      if (!x) return;
      if (typeof x === "string") {
        for (const c of x.split(/\s+/)) if (c) out.add(c);
        return;
      }
      if (Array.isArray(x)) {
        for (const e of x) walk(e);
        return;
      }
      if (typeof x === "object") {
        for (const [k, vv] of Object.entries(x)) if (vv) out.add(k);
        return;
      }
    };
    walk(v);
    return out;
  }

  // packages/slot-runtime/src/expr.ts
  var PURE_CALLS = {
    // —— Math（纯计算）——
    "Math.abs": Math.abs,
    "Math.ceil": Math.ceil,
    "Math.floor": Math.floor,
    "Math.round": Math.round,
    "Math.trunc": Math.trunc,
    "Math.sign": Math.sign,
    "Math.sqrt": Math.sqrt,
    "Math.cbrt": Math.cbrt,
    "Math.pow": Math.pow,
    "Math.exp": Math.exp,
    "Math.log": Math.log,
    "Math.log2": Math.log2,
    "Math.log10": Math.log10,
    "Math.min": Math.min,
    "Math.max": Math.max,
    // —— 类型转换（call 形态，非 new）——
    "String": String,
    "Number": Number,
    "Boolean": Boolean,
    // —— 解析 / 判定（全局）——
    "parseInt": parseInt,
    "parseFloat": parseFloat,
    "isNaN": isNaN,
    "isFinite": isFinite,
    "Number.isFinite": Number.isFinite,
    "Number.isInteger": Number.isInteger,
    "Number.isNaN": Number.isNaN,
    // —— 数组判定 ——
    "Array.isArray": Array.isArray
  };
  var PURE_METHODS = {
    // —— Array（非变异）——
    join: (recv, sep) => Array.isArray(recv) ? recv.join(sep === void 0 ? "," : String(sep)) : void 0,
    slice: (recv, a, b) => typeof recv === "string" || Array.isArray(recv) ? recv.slice(a, b) : void 0,
    concat: (recv, ...rest) => Array.isArray(recv) ? recv.concat(...rest) : void 0,
    indexOf: (recv, x) => typeof recv === "string" || Array.isArray(recv) ? recv.indexOf(x) : void 0,
    includes: (recv, x) => typeof recv === "string" || Array.isArray(recv) ? recv.includes(x) : void 0,
    // —— String（非变异）——
    toUpperCase: (recv) => typeof recv === "string" ? recv.toUpperCase() : void 0,
    toLowerCase: (recv) => typeof recv === "string" ? recv.toLowerCase() : void 0,
    trim: (recv) => typeof recv === "string" ? recv.trim() : void 0,
    trimStart: (recv) => typeof recv === "string" ? recv.trimStart() : void 0,
    trimEnd: (recv) => typeof recv === "string" ? recv.trimEnd() : void 0,
    charAt: (recv, i) => typeof recv === "string" ? recv.charAt(i) : void 0,
    padStart: (recv, n, pad) => typeof recv === "string" ? recv.padStart(n, pad) : void 0,
    padEnd: (recv, n, pad) => typeof recv === "string" ? recv.padEnd(n, pad) : void 0,
    repeat: (recv, n) => typeof recv === "string" ? recv.repeat(n) : void 0,
    substring: (recv, a, b) => typeof recv === "string" ? recv.substring(a, b) : void 0,
    startsWith: (recv, x) => typeof recv === "string" ? recv.startsWith(x) : void 0,
    endsWith: (recv, x) => typeof recv === "string" ? recv.endsWith(x) : void 0,
    // —— Number（非变异）——
    toFixed: (recv, n) => typeof recv === "number" ? recv.toFixed(n) : void 0,
    toString: (recv) => recv === void 0 || recv === null ? void 0 : String(recv)
  };
  var GLOBAL_CONST_MEMBERS = {
    "Math.PI": Math.PI,
    "Math.E": Math.E,
    "Math.LN2": Math.LN2,
    "Math.LN10": Math.LN10,
    "Math.LOG2E": Math.LOG2E,
    "Math.LOG10E": Math.LOG10E,
    "Math.SQRT2": Math.SQRT2,
    "Math.SQRT1_2": Math.SQRT1_2,
    "Number.MAX_SAFE_INTEGER": Number.MAX_SAFE_INTEGER,
    "Number.MIN_SAFE_INTEGER": Number.MIN_SAFE_INTEGER,
    "Number.EPSILON": Number.EPSILON,
    "Number.MAX_VALUE": Number.MAX_VALUE,
    "Number.MIN_VALUE": Number.MIN_VALUE
  };
  function toNum(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") return v.trim() === "" ? 0 : Number(v);
    if (v === null) return 0;
    if (v === void 0) return NaN;
    return NaN;
  }
  function evalExpr(p, ctx) {
    switch (p.k) {
      case "root":
        return ctx.read(p.name);
      case "lit":
        return p.v;
      case "undef":
        return void 0;
      case "mem": {
        const o = evalExpr(p.obj, ctx);
        if (o == null) return void 0;
        return o[p.key];
      }
      case "memdyn": {
        const o = evalExpr(p.obj, ctx);
        if (o == null) return void 0;
        const k = evalExpr(p.key, ctx);
        return o[String(k)];
      }
      case "un": {
        const v = evalExpr(p.arg, ctx);
        const uop = p.op;
        switch (uop) {
          case "!":
            return !v;
          case "-":
            return -toNum(v);
          case "+":
            return +toNum(v);
          default:
            throw new Error(`\u672A\u77E5\u4E00\u5143\u8FD0\u7B97\u7B26\uFF1A${String(uop)}`);
        }
      }
      case "bin": {
        const l = evalExpr(p.l, ctx);
        const r = evalExpr(p.r, ctx);
        const bop = p.op;
        switch (bop) {
          case "+":
            if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
            return toNum(l) + toNum(r);
          case "-":
            return toNum(l) - toNum(r);
          case "*":
            return toNum(l) * toNum(r);
          case "/":
            return toNum(l) / toNum(r);
          case "%":
            return toNum(l) % toNum(r);
          case "===":
            return l === r;
          case "!==":
            return l !== r;
          case "<":
            return l < r;
          case ">":
            return l > r;
          case "<=":
            return l <= r;
          case ">=":
            return l >= r;
          default:
            throw new Error(`\u672A\u77E5\u4E8C\u5143\u8FD0\u7B97\u7B26\uFF1A${String(bop)}`);
        }
      }
      case "logi": {
        const l = evalExpr(p.l, ctx);
        if (p.op === "&&") return l ? evalExpr(p.r, ctx) : l;
        if (p.op === "||") return l ? l : evalExpr(p.r, ctx);
        return l === null || l === void 0 ? evalExpr(p.r, ctx) : l;
      }
      case "cond":
        return evalExpr(p.t, ctx) ? evalExpr(p.c, ctx) : evalExpr(p.a, ctx);
      case "obj": {
        const o = {};
        for (const pr of p.props) o[pr.key] = evalExpr(pr.value, ctx);
        return o;
      }
      case "arr":
        return p.items.map((x) => evalExpr(x, ctx));
      case "mcall": {
        const recv = evalExpr(p.recv, ctx);
        if (recv === void 0 || recv === null) return void 0;
        const impl = PURE_METHODS[p.method];
        if (!impl) {
          throw new Error(`\u8868\u8FBE\u5F0F\u7A0B\u5E8F\u5F15\u7528\u4E86\u975E\u767D\u540D\u5355\u65B9\u6CD5\uFF1A${p.method}\uFF08\u89C1 slot-runtime/expr.ts \u7684 PURE_METHODS\uFF09`);
        }
        const args = p.args.map((a) => evalExpr(a, ctx));
        return impl(recv, ...args);
      }
      case "call": {
        const fn = PURE_CALLS[p.fn];
        if (typeof fn !== "function") {
          throw new Error(`\u8868\u8FBE\u5F0F\u7A0B\u5E8F\u5F15\u7528\u4E86\u975E\u767D\u540D\u5355\u51FD\u6570\uFF1A${p.fn}\uFF08\u89C1 slot-runtime/expr.ts \u7684 PURE_CALLS\uFF09`);
        }
        const args = p.args.map((a) => evalExpr(a, ctx));
        return fn(...args);
      }
      default: {
        const never = p;
        throw new Error(`\u672A\u77E5\u8868\u8FBE\u5F0F\u8282\u70B9\uFF1A${JSON.stringify(never)}`);
      }
    }
  }

  // packages/slot-runtime/src/list-registry.ts
  var ListRegistry = class {
    constructor() {
      /** listId → itemKey → (itemSlotId → nodeId) */
      this.items = /* @__PURE__ */ new Map();
      /** 统计（诊断：解释"这次 item 更新为什么没走快路径"） */
      this.hits = 0;
      this.misses = 0;
    }
    /**
     * 登记一个列表项
     *
     * @param listId    编译期分配的列表 id
     * @param itemKey   该行的稳定 key（**绝不用下标**——下标在 splice 后会命中错项，方案坑位 #5）
     * @param slotNodes item 内槽位 id → 该槽位对应的**节点 id**
     */
    registerItem(listId, itemKey, slotNodes) {
      let byKey = this.items.get(listId);
      if (!byKey) {
        byKey = /* @__PURE__ */ new Map();
        this.items.set(listId, byKey);
      }
      const m = slotNodes instanceof Map ? slotNodes : new Map(Object.entries(slotNodes).map(([k, v]) => [Number(k), v]));
      byKey.set(itemKey, m);
    }
    /** 批量登记（列表首帧渲染后一次性登记全部项——避免逐项调用） */
    registerItems(listId, entries) {
      for (const e of entries) this.registerItem(listId, e.itemKey, e.slotNodes);
    }
    /** 解析：该列表项内某槽位对应的节点 id（未登记 ⇒ undefined，调用方回退 LIST_UPDATE） */
    resolveNode(listId, itemKey, slotId) {
      const hit = this.items.get(listId)?.get(itemKey)?.get(slotId);
      if (hit === void 0) this.misses++;
      else this.hits++;
      return hit;
    }
    /** 移除项（splice 删除时调用，防止 key 被复用时命中已删项） */
    removeItem(listId, itemKey) {
      return this.items.get(listId)?.delete(itemKey) ?? false;
    }
    /** 整体清空某个列表（LIST_SET 整体换数据源时） */
    clearList(listId) {
      this.items.delete(listId);
    }
    /** 清空全部（卸载页面时） */
    clear() {
      this.items.clear();
    }
    get size() {
      let n = 0;
      for (const byKey of this.items.values()) n += byKey.size;
      return n;
    }
    get stats() {
      return { hits: this.hits, misses: this.misses, items: this.size };
    }
  };

  // packages/slot-runtime/src/runtime.ts
  var VaporRuntime = class {
    constructor(table, rt, evaluators, registry, onComponentProp, nodeIdOffset = 0, skipNodeIds, onPaintProp) {
      this.table = table;
      this.rt = rt;
      this.evaluators = evaluators;
      this.registry = registry;
      this.onComponentProp = onComponentProp;
      this.nodeIdOffset = nodeIdOffset;
      this.skipNodeIds = skipNodeIds;
      this.onPaintProp = onPaintProp;
      this.slots = /* @__PURE__ */ new Map();
      this.slotById = /* @__PURE__ */ new Map();
      this.evalImpls = /* @__PURE__ */ new Map();
      this.sourcesOfSlot = /* @__PURE__ */ new Map();
      /**
       * ★★未能实例化求值器的槽位（**诊断，不许静默**）
       *
       * 【为什么必须有（本仓实测）】表达式引用外层别名或含运算时编译器给 `expr` 形态，
       *   而 `expr` 只支持纯路径 ⇒ `impl` 为 undefined。首版**直接 continue** ⇒
       *   该槽位永不写、且无任何提示（静默不更新的典型）。
       */
      this.uninstantiatedSlots = [];
      /** ★行内槽位的按键值缓存（`slotId:key` → 上次值）——只发变化行 */
      /**
       * ★★行内值缓存（**免字符串拼接**，2026-09-29 优化）
       *
       * 【为什么改（本仓实测的瓶颈）】原实现每 (槽位 × 行) 都做一次
       *   `` `${spec.slotId}:${key}` `` 字符串拼接 + Map 查存；1000 行 × 3 槽位 = 3000 次
       *   ⇒ 在 `V11` 测得单行更新 **JS 侧 6.76ms**（扫描成本主导，而增量只有 1 条指令）。
       *   ⇒ 改**嵌套 Map**（listId → slotId → key → value）：键是数字/字符串原值，无拼接、无临时字符串。
       *   ★正确性不变（同一 (listId, slotId, key) 三元组仍是唯一键）。
       */
      this.itemValueCache = /* @__PURE__ */ new Map();
      this.loaded = false;
      /* ── ★★P2-5（2026-10-03）：v-once / v-memo 的运行时状态 ── */
      /**
       * v-once：已写过的槽位 id（**只写一次**——首次写入后永久冻结）。
       * ★为什么记在运行时（而不是把槽位从表里删掉）：表是编译产物（只读、可序列化）；
       *   而"写过没有"是**实例态**（页面重挂载 ⇒ 重新写一次，与官方"重挂载重新渲染"一致）。
       */
      this.onceWritten = /* @__PURE__ */ new Set();
      /** ★批次 30：每节点上次由动态 `:class` 施加的引擎字段（关掉类 ⇒ 需清除这些字段） */
      this.lastClassFields = /* @__PURE__ */ new Map();
      /** v-memo：各组的**依赖基线**（上一次比较时的值；缺省 = 还没建过基线 ⇒ 首帧必脏） */
      this.memoBaseline = /* @__PURE__ */ new Map();
      /**
       * v-memo：组在本**帧**已被判定为"依赖变了"的标记（值 = 帧号）。
       *
       * 【为什么按帧记（组语义的关键）】一帧里多个源变化可能触到同组多个槽位——
       *   第一次判定"变了"之后，**同帧其余槽位必须照常写**（组 = 子树整体更新）；
       *   而"一次判定管一帧"的边界只有 `flush()`（见 `SlotRuntime.frameId`）。
       */
      this.memoDirtyFrame = /* @__PURE__ */ new Map();
      /* ── ★★★P3-3（2026-10-03）：可见性变化日志（`<Transition>` 的**驱动源**）──
       *
       * 【为什么运行时记、桥来消费】`v-show` / `v-if` 的切换在运行时表现为 `visible` 槽位写入
       *   ⇒ 编成 `TOGGLE_VIS` 指令（内核只管**应用**可见性，不知道"要不要过渡"）。
       *   而"这个节点有没有过渡声明"是**编译产物**（`LayoutNode.transition`）、
       *   "把动画交给谁播"是**宿主**（`proteusHost.animStart`）——桥正好两头都有。
       *   ⇒ 运行时只负责**记事实**（谁、变成什么），桥负责**查声明 + 转发**（分层正确、可单测）。
       *
       * 【为什么要去重】`relink` 会重写全部槽位（含未变的可见性）⇒ 不去重会把"每次 relink"
       *   当成一次切换（过渡被反复触发）。⇒ 与上一状态比较，**只在真的翻转时记**。
       */
      this.visibilityLog = [];
      this.lastVisible = /* @__PURE__ */ new Map();
    }
    /**
     * 从订阅表重建求值函数（把**可序列化的声明**变成可执行函数）
     *
     * 【为什么单独一步（而不是直接吃函数）】方案 §4.4 要求产物可序列化
     *   （跨端禁 eval）⇒ 声明与实现分离：声明随产物下发，实现在各端本地重建。
     *   本方法就是「本地重建」的参考实现：
     *     · `member` —— 纯路径访问，**免解析**（热路径主力）
     *     · `const`  —— 常量
     *     · `expr`   —— 表达式文本（各端按自己的能力求值；本实现给出最简单的成员回退）
     */
    static buildEvaluators(specs) {
      const out = /* @__PURE__ */ new Map();
      for (const s of specs) {
        switch (s.form) {
          case "member": {
            const segs = (s.path ?? "").split(".").filter(Boolean);
            const [root, ...rest] = segs;
            out.set(s.evaluatorId, (ctx) => {
              let v = ctx.read(root);
              for (const seg of rest) {
                if (v == null || typeof v !== "object") return void 0;
                v = v[seg];
              }
              return v;
            });
            break;
          }
          case "program": {
            const prog = s.program;
            if (!prog) break;
            out.set(s.evaluatorId, (ctx) => evalExpr(prog, ctx));
            break;
          }
          case "const": {
            const text = (s.expr ?? "").trim();
            const parsed = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text === "true" ? true : text === "false" ? false : text.replace(/^['"]|['"]$/g, "");
            out.set(s.evaluatorId, () => parsed);
            break;
          }
          case "expr": {
            const expr = (s.expr ?? "").trim();
            if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) {
              const segs = expr.split(".");
              const [root, ...rest] = segs;
              out.set(s.evaluatorId, (ctx) => {
                let v = ctx.read(root);
                for (const seg of rest) {
                  if (v == null || typeof v !== "object") return void 0;
                  v = v[seg];
                }
                return v;
              });
            }
            break;
          }
          default:
            break;
        }
      }
      return out;
    }
    /** 注册订阅（方案 §4.3 Step 5：源变化 → 求值 → 直写槽位） */
    load(ctx, subscribe) {
      const unknownSources = [];
      const unsupportedEvaluators = [];
      let l1Slots = 0;
      for (const src of this.table.sources) {
        for (const spec of src.slots) {
          const impl = this.evaluators.get(spec.evaluatorId);
          if (!impl) {
            unsupportedEvaluators.push({ evaluatorId: spec.evaluatorId, reason: "\u6C42\u503C\u51FD\u6570\u672A\u5B9E\u4F8B\u5316\uFF08\u5F62\u6001\u4E0D\u652F\u6301\uFF09" });
            continue;
          }
          let slot = this.slots.get(spec.slotId);
          if (!slot) {
            slot = createSlot(
              {
                id: spec.slotId,
                // ★P1-3：子组件的 nodeId 统一加偏移（内核/宿主在**父树空间**里认节点）
                nodeId: spec.nodeId + this.nodeIdOffset,
                kind: spec.kind,
                keyId: this.rt.keys.intern(spec.propKey),
                listId: spec.listId ?? spec.slotId,
                listSlotId: spec.itemSlotId ?? spec.slotId,
                itemKind: spec.itemKind,
                itemValueField: spec.itemValueField,
                itemKeyField: spec.itemKeyField,
                scope: spec.scope
              },
              this.rt.keys,
              this.rt.strings,
              void 0,
              this.registry
              // ★传入注册表（缺省 ⇒ list-item 回退 LIST_UPDATE，保持 V3 行为）
            );
            this.slots.set(spec.slotId, slot);
          }
          this.slotById.set(spec.slotId, { slot, spec, evalId: spec.evaluatorId });
          const deps = this.sourcesOfSlot.get(spec.slotId) ?? [];
          deps.push(src.sourceName);
          this.sourcesOfSlot.set(spec.slotId, deps);
          l1Slots++;
        }
      }
      for (const src of this.table.sources) {
        subscribe(src.sourceName, () => {
          this.writeSlotsOfSource(src.sourceName, ctx);
        });
      }
      for (const src of this.table.sources) {
        for (const spec of src.slots) {
          if (spec.kind !== "list-item") continue;
          if (!this.evaluators.get(spec.evaluatorId)) {
            this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey });
          }
        }
      }
      this.loaded = true;
      return {
        l1Slots,
        l0Slots: this.table.l0Slots.length,
        unknownSources,
        unsupportedEvaluators,
        // ★行内槽位的未实例化清单（与 unsupportedEvaluators 同性质：**上报而非静默**）
        uninstantiatedSlots: this.uninstantiatedSlots.slice()
      };
    }
    /** 写入某源驱动的全部槽位（源变化时由订阅回调触发） */
    writeSlotsOfSource(sourceName, ctx) {
      for (const src of this.table.sources) {
        if (src.sourceName !== sourceName) continue;
        this.writeListItems(src, ctx);
        for (const spec of src.slots) {
          if (spec.kind === "list-item") continue;
          if (spec.kind === "list-data") continue;
          if (spec.once && this.onceWritten.has(spec.slotId)) continue;
          if (this.skipNodeIds?.has(spec.nodeId + this.nodeIdOffset)) continue;
          if (spec.propKey === "paint.class" && this.onPaintProp) {
            const implC = this.evaluators.get(spec.evaluatorId);
            if (implC) {
              const cv = implC(ctx);
              const fields = resolveDynamicClasses(cv, this.table.classRules ?? []);
              const nid = spec.nodeId + this.nodeIdOffset;
              const nextKeys = new Set(Object.keys(fields));
              const prev = this.lastClassFields.get(nid);
              if (prev) {
                for (const k of prev) if (!nextKeys.has(k)) this.onPaintProp(nid, `paint.${k}`, void 0);
              }
              for (const [fk, fv] of Object.entries(fields)) this.onPaintProp(nid, `paint.${fk}`, fv);
              this.lastClassFields.set(nid, nextKeys);
              const eC = this.slotById.get(spec.slotId);
              if (eC) eC.slot.value = cv;
            }
            continue;
          }
          if (spec.propKey.startsWith("paint.") && this.onPaintProp) {
            const impl2 = this.evaluators.get(spec.evaluatorId);
            if (impl2) {
              const v = impl2(ctx);
              this.onPaintProp(spec.nodeId + this.nodeIdOffset, spec.propKey, v);
              const e2 = this.slotById.get(spec.slotId);
              if (e2) e2.slot.value = v;
            }
            continue;
          }
          if (spec.memoId !== void 0 && !this.memoGroupDirty(spec.memoId, ctx)) continue;
          const entry = this.slotById.get(spec.slotId);
          const impl = this.evaluators.get(spec.evaluatorId);
          if (!entry || !impl) continue;
          const value = impl(ctx);
          if (spec.kind === "component-prop" && this.onComponentProp) {
            const propName = spec.propKey.startsWith("component.") ? spec.propKey.slice("component.".length) : spec.propKey;
            this.onComponentProp(spec.nodeId, propName, value);
            entry.slot.value = value;
            continue;
          }
          this.rt.setSlot(entry.slot, value);
          if (spec.once) this.onceWritten.add(spec.slotId);
          if (spec.kind === "visibility") {
            const now = Boolean(value);
            const prev = this.lastVisible.get(spec.nodeId);
            if (prev !== void 0 && prev !== now) {
              this.visibilityLog.push({ nodeId: spec.nodeId, visible: now });
            }
            this.lastVisible.set(spec.nodeId, now);
          }
        }
      }
    }
    /**
     * ★★**v-memo 组脏判定**（P2-5）：依赖逐项比较（`Object.is`），任一变化即"脏"。
     *
     * 【语义（对齐 Vue `withMemo`）】依赖未变 ⇒ **跳过**该子树更新；变了 ⇒ 照常更新，
     *   并把本次依赖值记为基线供下轮比较。
     * 【诚实边界】组定义缺失（产物异常）⇒ 返回 true（照常更新）——**不静默冻结**：
     *   "少一层优化"可接受，"该更新的不更新"不可接受。
     */
    memoGroupDirty(memoId, ctx) {
      const fid = this.rt.frameId;
      if (this.memoDirtyFrame.get(memoId) === fid) return true;
      const group = this.table.memoGroups?.find((g) => g.memoId === memoId);
      if (!group) return true;
      const now = [];
      for (const prog of group.deps) {
        try {
          now.push(evalExpr(prog, ctx));
        } catch {
          now.push(void 0);
        }
      }
      const prev = this.memoBaseline.get(memoId);
      const changed = !prev || now.some((v, i) => !Object.is(v, prev[i]));
      if (changed) {
        this.memoBaseline.set(memoId, now);
        this.memoDirtyFrame.set(memoId, fid);
      }
      return changed;
    }
    /**
     * ★列表行内槽位通道：按行求值 → 与上一轮**按 key 缓存**的值 diff → 只发变化行
     *
     * 【关键：行作用域求值】`item.w` 的求值需要**当前行**绑定到 v-for 作用域。
     *   故每行构造一个 `rowCtx`：`read(scope)` 返回该行，其余名透传原 ctx。
     *   （编译器在槽位上给了 `scope` 才能这么做——见 SlotSubscription.scope）
     */
    writeListItems(src, ctx) {
      const itemSlots = src.slots.filter((x) => x.kind === "list-item");
      if (itemSlots.length === 0) return;
      const rowsCache = /* @__PURE__ */ new Map();
      const rowsOfList2 = (listId, spec) => {
        const cached = rowsCache.get(listId);
        if (cached) return cached;
        const out = [];
        const keyOf2 = (r, i) => spec.itemKeyField && r && r[spec.itemKeyField] !== void 0 ? String(r[spec.itemKeyField]) : String(i);
        const segs = (spec.sourceExpr ?? "").split(".").filter(Boolean);
        const topRows = ctx.read(src.sourceName);
        if (!Array.isArray(topRows)) return out;
        const walkSegs = segs[0] === src.sourceName ? segs.slice(1) : segs;
        let current = topRows.map((row) => ({ row, ancestors: [] }));
        for (let seg = 0; seg < walkSegs.length; seg++) {
          const field = walkSegs[seg];
          const next = [];
          for (const c of current) {
            const arr = c.row?.[field];
            if (!Array.isArray(arr)) continue;
            for (const x of arr) {
              next.push({ row: x, ancestors: [...c.ancestors, c.row] });
            }
          }
          current = next;
        }
        for (let i = 0; i < current.length; i++) {
          out.push({ key: keyOf2(current[i].row, i), row: current[i].row, ancestors: current[i].ancestors });
        }
        rowsCache.set(listId, out);
        return out;
      };
      const rowCtxCache = /* @__PURE__ */ new Map();
      for (const spec of itemSlots) {
        const impl = this.evaluators.get(spec.evaluatorId);
        if (!impl) {
          this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey });
          continue;
        }
        const scope = spec.scope ?? "";
        const rows = rowsOfList2(spec.listId ?? -1, spec);
        for (const rowRef of rows) {
          const key = rowRef.key;
          const row = rowRef.row;
          const ancestors = rowRef.ancestors;
          const cached = rowCtxCache.get(rowRef);
          const rowCtx = cached && cached.scope === scope ? cached.ctx : this.makeRowCtx(scope, row, ancestors, ctx);
          if (!(cached && cached.scope === scope)) rowCtxCache.set(rowRef, { scope, ctx: rowCtx });
          const value = impl(rowCtx);
          this.diffAndEmit(spec, key, value);
        }
      }
    }
    /**
     * ★★行级失效：**只重算指定行**的 list-item 槽位（2026-09-29 新增）
     *
     * 【为什么需要（本仓真机实测的瓶颈）】粗粒度触发（`triggers.get('list')` ⇒ `relink`）只知道
     *   "源变了"、不知道"哪一行变了" ⇒ 只能**全表重扫**：1000 行 × 3 槽位 = 3000 次求值 + diff。
     *   真机 `V11` 实测该段 **7.03ms**（列表更新总 11ms）——而 Vapor 的设计本意是
     *   **O(1) 槽位直写**（改哪行算哪行）。本方法就是那个 O(1) 入口。
     *
     * 【调用方责任】提供**变更行的身份**（`key` + 行对象 + 祖先链）——它天然知道（编译器产出的
     *   行作用域效应 / 应用层的不可变更新都携带这些）。**不知道时不要调用**，走 `relink` 全扫（正确但慢）。
     *
     * 【正确性】与全扫路径**共用** `makeRowCtx` / `diffAndEmit` / `itemValueCache`（唯一实现
     *   ⇒ 两条路径不会漂移）；缓存是实例级的 ⇒ 全扫与行级失效交替调用也保持一致。
     *
     * @param listId 目标列表 id（订阅表里的 `listId`）
     * @param key    行标识（= `itemKeyField` 对应的值，与 `emitListItem` 的键一致）
     * @param row    该行的**数据对象**
     * @param ancestors 该行的祖先行链（顶层列表传空数组；嵌套列表按「自外向内」）
     */
    relinkRow(listId, key, row, ancestors = [], ctx) {
      const evalCtx = ctx ?? this.lastCtx ?? { read: () => void 0 };
      for (const spec of this.listSpecsOf(listId)) {
        const impl = this.evaluators.get(spec.evaluatorId);
        if (!impl) continue;
        const rowCtx = this.makeRowCtx(spec.scope ?? "", row, ancestors, evalCtx);
        this.diffAndEmit(spec, key, impl(rowCtx));
      }
    }
    /** scope（v-for 别名）→ listId 反查（`relinkRow` 用；作用域由订阅表声明，不猜） */
    listIdOfScope(scope) {
      for (const src of this.table.sources) {
        for (const sl of src.slots) if (sl.kind === "list-item" && (sl.scope ?? "") === scope) return sl.listId ?? -1;
      }
      return void 0;
    }
    /** 该列表的全部 list-item 槽位（`relinkRow` 用；与 `writeListItems` 同一数据源） */
    listSpecsOf(listId) {
      const out = [];
      for (const src of this.table.sources) {
        for (const sl of src.slots) if (sl.kind === "list-item" && (sl.listId ?? -1) === listId) out.push(sl);
      }
      return out;
    }
    /** ★行作用域上下文（**唯一实现**）：当前行别名 + 各层祖先别名 —— `writeListItems` 与 `relinkRow` 共用 */
    makeRowCtx(scope, row, ancestors, ctx) {
      if (!scope) return ctx;
      const lid = this.listIdOfScope(scope);
      const ancestorScopes = lid === void 0 ? [] : this.ancestorScopesOf(lid);
      return makeScopedRead(scope, row, ancestors, ancestorScopes, ctx);
    }
    /** ★值 diff + 发射（**唯一实现**）：嵌套 Map 免拼接：listId/slotId 均为数字键 */
    diffAndEmit(spec, key, value) {
      const listId = spec.listId ?? -1;
      let bySlot = this.itemValueCache.get(listId);
      if (!bySlot) {
        bySlot = /* @__PURE__ */ new Map();
        this.itemValueCache.set(listId, bySlot);
      }
      let byKey = bySlot.get(spec.slotId);
      if (!byKey) {
        byKey = /* @__PURE__ */ new Map();
        bySlot.set(spec.slotId, byKey);
      }
      if (byKey.get(key) === value) return;
      byKey.set(key, value);
      this.emitListItem(spec, key, value);
    }
    /** 发一条行内更新指令：解析得到 nodeId 就发普通指令，否则回退 LIST_UPDATE */
    emitListItem(spec, key, value) {
      const nodeId = this.registry?.resolveNode(spec.listId ?? -1, key, spec.itemSlotId ?? -1);
      if (nodeId !== void 0 && this.skipNodeIds?.has(nodeId)) return;
      if (nodeId !== void 0) {
        if ((spec.itemKind ?? "style") === "text") {
          this.rt.buffer.push({ op: 3 /* SET_TEXT */, nodeId, textRef: this.rt.strings.intern(String(value)) });
        } else {
          this.rt.buffer.push({
            op: 2 /* SET_STYLE */,
            nodeId,
            keyId: this.rt.keys.intern(spec.propKey),
            value: typeof value === "number" ? value : Number(value) || 0
          });
        }
      } else {
        this.rt.buffer.push({
          op: 34 /* LIST_UPDATE */,
          listId: spec.listId ?? -1,
          itemKeyRef: this.rt.strings.intern(key),
          slotId: spec.itemSlotId ?? -1,
          value: typeof value === "number" ? value : Number(value) || 0
        });
      }
    }
    /** ★首帧同步：把所有 L1 槽位按当前源值写一遍（否则首屏不会出现这些值） */
    relink(ctx) {
      this.lastCtx = ctx;
      for (const src of this.table.sources) {
        this.writeSlotsOfSource(src.sourceName, ctx);
      }
    }
    /**
     * 某列表的**别名链**（自外向内；末位是它自身的 scope）
     *
     * 【为什么需要】`rowCtx` 要按位置把「祖先行」绑给对应的外层别名——
     *   而位置对应关系依赖"自外向内"的稳定顺序（由 `parentListId` 逐级上溯构造）。
     */
    ancestorScopesOf(listId) {
      const chain = [];
      let cur = listId;
      const allSlots = this.table.sources.flatMap((x) => x.slots);
      let guard = 0;
      while (cur !== void 0 && guard < 32) {
        const spec = allSlots.find((x) => x.kind === "list-item" && x.listId === cur);
        if (!spec) break;
        chain.unshift(spec.scope ?? "");
        cur = spec.parentListId;
        guard++;
      }
      return chain;
    }
    /** 取某源的行数组（列表源 ⇒ 数组；非数组返回空）——仅供「无 :key 时用下标兜底」 */
    rowsOfSource(sourceName, ctx) {
      const v = ctx.read(sourceName);
      return Array.isArray(v) ? v : [];
    }
    /**
     * ★★★**取走可见性变化**（P3-3；取走即复位——与 `takePatches` 同款"自上次取走以来"语义）。
     *
     * 桥侧用法：`relink`/手势回调后 drain ⇒ 对每个变化查模板的 `transition` 声明 ⇒
     * 有声明则调 `proteusHost.animStart(...)`（宿主把动画交给内核）。
     */
    takeVisibilityChanges() {
      if (this.visibilityLog.length === 0) return [];
      const out = this.visibilityLog.slice();
      this.visibilityLog.length = 0;
      return out;
    }
    /** 某槽位是否已建立订阅（诊断：确认"这个槽位真的被接管了"） */
    hasSlot(slotId) {
      return this.slots.has(slotId);
    }
    get loaded_() {
      return this.loaded;
    }
    /** 该槽位由哪些源驱动（诊断 / explain） */
    depsOf(slotId) {
      return this.sourcesOfSlot.get(slotId) ?? [];
    }
    /** L1 槽位表（供宿主对账：哪些槽位由 L1 接管） */
    slotIds() {
      return [...this.slots.keys()].sort((a, b) => a - b);
    }
  };
  function makeScopedRead(scope, row, ancestors, ancestorScopes, ctx) {
    if (!scope) return ctx;
    return {
      read: (n) => {
        if (n === scope) return row;
        const idx = ancestorScopes.indexOf(n);
        if (idx >= 0 && idx < ancestors.length) return ancestors[idx];
        return ctx.read(n);
      }
    };
  }

  // packages/slot-runtime/src/instantiate.ts
  function applyStyleField(target, propKey, key, v, classRules) {
    if (propKey === "paint.class") {
      const fields = resolveDynamicClasses(v, classRules ?? []);
      for (const [k, val] of Object.entries(fields)) target[k] = val;
      return;
    }
    ;
    target[key] = v;
  }
  function engineFieldOf(propKey) {
    if (propKey === "text.content") return { kind: "text" };
    const m = propKey.match(/^(?:layout|paint|text)\.(.+)$/);
    if (!m) return null;
    return { kind: "style", key: m[1] };
  }
  function evalTextSegments(segs, read) {
    let out = "";
    for (const s of segs) {
      if ("text" in s) {
        out += s.text;
        continue;
      }
      try {
        const v = evalExpr(s.expr, { read });
        out += v === void 0 || v === null ? "" : String(v);
      } catch {
      }
    }
    return out;
  }
  function rowsOfList(listId, meta, table, read) {
    if (!table) return [];
    const allSlots = table.sources.flatMap((s) => s.slots);
    const itemSlots = allSlots.filter((x) => x.kind === "list-item" && x.listId === listId);
    const spec = itemSlots[0] ?? allSlots.find((x) => x.kind === "list-data" && x.listId === listId);
    if (!spec) return [];
    const srcName = table.sources.find((s) => s.slots.some((x) => x.listId === listId))?.sourceName ?? "";
    const segs = (meta?.sourceField || spec.sourceExpr || "").split(".").filter(Boolean);
    const topRows = read(srcName);
    if (!Array.isArray(topRows)) return [];
    const walkSegs = segs[0] === srcName ? segs.slice(1) : segs;
    let cur = topRows;
    for (const field of walkSegs) {
      const next = [];
      for (const r of cur) {
        const arr = r?.[field];
        if (!Array.isArray(arr)) continue;
        for (const x of arr) next.push(x);
      }
      cur = next;
    }
    return cur;
  }
  function instantiateTemplate(tpl, opts) {
    const nodes = [];
    const idOffset = opts.idOffset ?? 0;
    const instNotes = [];
    const maxTemplateId = tpl.nodes.reduce((m, n) => Math.max(m, n.id), 0);
    let nextId = opts.firstRowInstanceId ?? maxTemplateId + 1;
    let allocated = 0;
    let reused = 0;
    const rowLists = new Map(tpl.lists.map((l) => [l.listId, l]));
    const byId = /* @__PURE__ */ new Map();
    let valuesFilled = 0;
    const evaluators = opts.table ? VaporRuntime.buildEvaluators(opts.table.evaluators) : /* @__PURE__ */ new Map();
    const ancestorScopesOf = (listId) => {
      const chain = [];
      let cur = listId;
      let guard = 0;
      while (cur !== void 0 && guard < 32) {
        const meta = rowLists.get(cur);
        if (!meta) break;
        chain.unshift(meta.scope ?? "");
        cur = meta.parentListId;
        guard++;
      }
      return chain;
    };
    const evalInitial = (evaluatorId, ctx) => {
      const impl = evaluators.get(evaluatorId);
      if (!impl) return { ok: false };
      try {
        return { ok: true, value: impl(ctx) };
      } catch {
        return { ok: false };
      }
    };
    const virtualRows = [];
    const emit = (n, id, parentId, ctx = { read: opts.read }) => {
      const out = { id, parentId };
      if (n.style) for (const [k, v] of Object.entries(n.style)) {
        ;
        out[k] = v;
      }
      if (n.text !== void 0) out.text = n.text;
      if (n.textSegments && n.textSegments.length > 0) {
        out.text = evalTextSegments(n.textSegments, ctx.read);
      }
      if (n.tag) out.tag = n.tag;
      if (n.component) out.component = n.component;
      if (n.slotOutlet) out.slotOutlet = n.slotOutlet;
      if (n.slotFor) out.slotFor = n.slotFor;
      out.id = id + idOffset;
      out.parentId = parentId === null ? null : parentId + idOffset;
      nodes.push(out);
      byId.set(id, out);
    };
    const cloneRow = (listId, row, itemKey, first, rowIndex, parentOverrideId, collect, ancestors = []) => {
      const meta = rowLists.get(listId);
      const idMap = /* @__PURE__ */ new Map();
      let rowRootId = 0;
      const myIds = [];
      for (const tplId of meta.subtreeIds) {
        const engineId = first ? tplId : nextId++;
        if (!first) allocated++;
        else reused++;
        idMap.set(tplId, engineId);
        if (tplId === meta.rowRootId) rowRootId = engineId;
      }
      const rowRead = makeScopedRead(meta.scope ?? "", row, ancestors, ancestorScopesOf(listId), { read: opts.read });
      for (const tplId of meta.subtreeIds) {
        const tn = tpl.nodes.find((x) => x.id === tplId);
        const engineId = idMap.get(tplId);
        const tplParent = tn.parentId;
        let parentId = tplParent === null ? null : idMap.get(tplParent) ?? tplParent;
        if (parentOverrideId !== void 0 && tplId === meta.rowRootId) parentId = parentOverrideId;
        emit(tn, engineId, parentId, rowRead);
        myIds.push(engineId);
      }
      for (const inner of tpl.lists) {
        if (inner.parentListId !== listId) continue;
        let arr = row;
        for (const seg of (inner.sourceField ?? "").split(".").filter(Boolean)) {
          arr = arr?.[seg];
        }
        if (!Array.isArray(arr)) continue;
        const innerKeyField = opts.table?.sources.flatMap((s) => s.slots).find((x) => x.kind === "list-item" && x.listId === inner.listId)?.itemKeyField;
        for (let j = 0; j < arr.length; j++) {
          const innerRow = arr[j];
          const innerKey = innerKeyField && innerRow?.[innerKeyField] !== void 0 ? String(innerRow[innerKeyField]) : String(j);
          cloneRow(inner.listId, innerRow, innerKey, first && j === 0, j, rowRootId, myIds, [...ancestors, row]);
        }
      }
      virtualRows.push({
        index: rowIndex,
        key: itemKey,
        root: rowRootId + idOffset,
        ids: myIds.map((x) => x + idOffset)
      });
      if (collect) collect.push(...myIds);
      if (opts.table) {
        const itemSlots = opts.table.sources.flatMap((s) => s.slots).filter((x) => x.kind === "list-item" && x.listId === listId);
        if (itemSlots.length > 0) {
          const slotNodes = {};
          const rowCtx = makeScopedRead(meta.scope ?? "", row, ancestors, ancestorScopesOf(listId), {
            read: opts.read
          });
          for (const sl of itemSlots) {
            const mapped = idMap.get(sl.nodeId);
            if (mapped !== void 0) slotNodes[sl.itemSlotId] = mapped;
            if (mapped === void 0) continue;
            const target = byId.get(mapped);
            if (!target) continue;
            const f = engineFieldOf(sl.propKey);
            if (!f) continue;
            const ev0 = evalInitial(sl.evaluatorId, rowCtx);
            let v;
            if (ev0.ok) {
              v = ev0.value;
            } else {
              const field = sl.itemValueField;
              if (!field) continue;
              v = row[field];
              if (v === void 0) continue;
            }
            if (f.kind === "text") {
              target.text = v === void 0 || v === null ? "" : String(v);
            } else {
              applyStyleField(target, sl.propKey, f.key, v, opts.table?.classRules);
            }
            valuesFilled++;
          }
          if (opts.registry && Object.keys(slotNodes).length > 0) {
            const shifted = {};
            for (const [k, v] of Object.entries(slotNodes)) shifted[Number(k)] = v + idOffset;
            opts.registry.registerItem(listId, itemKey, shifted);
          }
        }
      }
      return rowRootId;
    };
    const rowMemberIds = /* @__PURE__ */ new Set();
    for (const l of tpl.lists) for (const id of l.subtreeIds) rowMemberIds.add(id);
    for (const n of tpl.nodes) {
      if (rowMemberIds.has(n.id)) {
        const meta = tpl.lists.find((l) => l.rowRootId === n.id);
        if (!meta) continue;
        if (meta.parentListId !== void 0) continue;
        const rows = rowsOfList(meta.listId, meta, opts.table, opts.read);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const keyOf2 = () => {
            const keyField = opts.table?.sources.flatMap((s) => s.slots).find((x) => x.kind === "list-item" && x.listId === meta.listId)?.itemKeyField;
            return keyField && row[keyField] !== void 0 ? String(row[keyField]) : String(i);
          };
          cloneRow(meta.listId, row, keyOf2(), i === 0, i);
        }
        continue;
      }
      emit(n, n.id, n.parentId);
    }
    if (opts.table) {
      for (const sl of opts.table.constantSlots ?? []) {
        const target = byId.get(sl.nodeId);
        if (!target) continue;
        const f = engineFieldOf(sl.propKey);
        if (!f) continue;
        const evS = evalInitial(sl.evaluatorId, { read: opts.read });
        if (!evS.ok) continue;
        const v = evS.value;
        if (f.kind === "text") {
          target.text = v === void 0 || v === null ? "" : String(v);
        } else {
          applyStyleField(target, sl.propKey, f.key, v, opts.table?.classRules);
        }
        valuesFilled++;
      }
      for (const src of opts.table.sources) {
        for (const sl of src.slots) {
          if (sl.kind === "list-item" || sl.kind === "list-data" || sl.kind === "component-prop") continue;
          const target = byId.get(sl.nodeId);
          if (!target) continue;
          const f = engineFieldOf(sl.propKey);
          if (!f) continue;
          const evS = evalInitial(sl.evaluatorId, { read: opts.read });
          let v;
          if (evS.ok) {
            v = evS.value;
          } else {
            v = opts.read(src.sourceName);
            if (v === void 0) continue;
          }
          if (f.kind === "text") {
            target.text = v === void 0 || v === null ? "" : String(v);
          } else {
            applyStyleField(target, sl.propKey, f.key, v, opts.table?.classRules);
          }
          valuesFilled++;
        }
      }
    }
    const componentMounts = [];
    const slotMounts = [];
    const droppedNodeIds = /* @__PURE__ */ new Set();
    let componentNodes = 0;
    const subtreeOf = (list, rootId) => {
      const doomed = /* @__PURE__ */ new Set([rootId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const x of list) {
          if (x.parentId !== null && !doomed.has(x.id) && doomed.has(x.parentId)) {
            doomed.add(x.id);
            grew = true;
          }
        }
      }
      return doomed;
    };
    const dissolveOutlets = (list, fills, evalProps) => {
      const consumed = /* @__PURE__ */ new Set();
      const placed = [];
      for (const outlet of list.filter((x) => x.slotOutlet)) {
        if (list.indexOf(outlet) < 0) continue;
        const name = outlet.slotOutlet.name;
        const fill = fills.get(name);
        const useFill = fill !== void 0 && fill.length > 0 && !consumed.has(name);
        if (useFill) {
          consumed.add(name);
          const outletProps = evalProps ? evalProps(outlet) : {};
          const doomed = subtreeOf(list, outlet.id);
          for (const id of doomed) droppedNodeIds.add(id);
          const idx = list.findIndex((x) => x.id === outlet.id);
          const kept = list.filter((x) => !doomed.has(x.id));
          kept.splice(Math.min(idx, kept.length), 0, ...fill);
          list.length = 0;
          list.push(...kept);
          for (const r of fill) {
            r.parentId = outlet.parentId;
            delete r.slotFor;
          }
          slotMounts.push({ outletNodeId: outlet.id, name, filled: true, contentIds: fill.map((x) => x.id), fallbackIds: [] });
          placed.push({ name, fill, outlet, props: outletProps });
        } else {
          const kids = list.filter((x) => x.parentId === outlet.id);
          const fallbackIds = [];
          if (kids.length > 0) {
            for (const k of kids) k.parentId = outlet.parentId;
            fallbackIds.push(...kids.map((x) => x.id));
            list.splice(list.indexOf(outlet), 1);
            droppedNodeIds.add(outlet.id);
          } else if (typeof outlet.text === "string" && outlet.text !== "") {
            delete outlet.slotOutlet;
            outlet.tag = "p-text";
          } else {
            list.splice(list.indexOf(outlet), 1);
            droppedNodeIds.add(outlet.id);
          }
          slotMounts.push({ outletNodeId: outlet.id, name, filled: false, contentIds: [], fallbackIds });
        }
      }
      return { consumed, placed };
    };
    if (opts.table?.componentIs && opts.table.componentIs.length > 0) {
      for (const ci of opts.table.componentIs) {
        const target = byId.get(ci.nodeId);
        if (!target) continue;
        const impl = evaluators.get(ci.evaluatorId);
        if (!impl) {
          instNotes.push(`\u52A8\u6001\u7EC4\u4EF6 \`:is="${ci.expr}"\`\uFF08\u8282\u70B9 ${ci.nodeId}\uFF09\u6C42\u503C\u5668\u672A\u5B9E\u4F8B\u5316 \u21D2 \u672A\u89E3\u6790`);
          continue;
        }
        let name;
        try {
          name = impl({ read: opts.read });
        } catch (e) {
          instNotes.push(`\u52A8\u6001\u7EC4\u4EF6 \`:is="${ci.expr}"\` \u6C42\u503C\u629B\u9519\uFF08${String(e?.message ?? e)}\uFF09\u21D2 \u672A\u89E3\u6790`);
          continue;
        }
        if (name === void 0 || name === null || name === "") {
          const doomed = subtreeOf(nodes, ci.nodeId);
          for (const id of doomed) droppedNodeIds.add(id);
          for (let i = nodes.length - 1; i >= 0; i--) if (doomed.has(nodes[i].id)) nodes.splice(i, 1);
          instNotes.push(`\u52A8\u6001\u7EC4\u4EF6 \`:is="${ci.expr}"\` \u6C42\u503C\u4E3A\u5047\uFF08${String(name)}\uFF09\u21D2 \u8282\u70B9\u5DF2\u6458\u9664\uFF08Vue \u540C\uFF09`);
          continue;
        }
        if (typeof name !== "string") {
          instNotes.push(
            `\u52A8\u6001\u7EC4\u4EF6 \`:is="${ci.expr}"\` \u6C42\u503C\u4E0D\u662F\u5B57\u7B26\u4E32\uFF08${typeof name}\uFF09\u21D2 \u672A\u89E3\u6790\uFF08\u672C\u5B9E\u73B0\u6309**\u7EC4\u4EF6\u540D**\u67E5\u6CE8\u518C\u8868\uFF1B\u7EC4\u4EF6\u5BF9\u8C61\u5F62\u6001\u4E3A\u540E\u7EED\u6279\u6B21\uFF09`
          );
          continue;
        }
        target.component = name;
        delete target.componentIs;
        instNotes.push(`\u52A8\u6001\u7EC4\u4EF6 \`:is="${ci.expr}"\` \u21D2 \u89E3\u6790\u4E3A ${name}\uFF08\u5B9E\u4F8B\u5316\u671F\u4E00\u6B21\u6027\u89E3\u6790\uFF09`);
      }
    }
    if (opts.components) {
      const depth = opts.componentDepth ?? 0;
      const boundaries = nodes.filter((n) => n.component);
      for (const boundary of boundaries) {
        if (droppedNodeIds.has(boundary.id)) continue;
        const name = boundary.component;
        const def = opts.components[name];
        if (!def) {
          instNotes.push(`\u7EC4\u4EF6 ${name}\uFF08\u8FB9\u754C\u8282\u70B9 ${boundary.id}\uFF09\u672A\u5728\u6CE8\u518C\u8868\u91CC \u21D2 \u5185\u90E8\u7559\u7A7A\uFF08\u5360\u4F4D\uFF09`);
          continue;
        }
        if (depth >= 8) {
          instNotes.push(`\u7EC4\u4EF6 ${name} \u5C55\u5F00\u6DF1\u5EA6\u8D85\u4E0A\u9650\uFF088\uFF09\u21D2 \u505C\u6B62\u9012\u5F52\uFF08\u9632\u81EA\u5F15\u7528\uFF09`);
          continue;
        }
        const boundaryLocalId = boundary.id - idOffset;
        const props = {};
        if (opts.table) {
          const allSlots = [
            ...opts.table.sources.flatMap((src) => src.slots.map((sl) => ({ sl, srcName: src.sourceName }))),
            ...(opts.table.constantSlots ?? []).map((sl) => ({ sl, srcName: void 0 }))
          ];
          for (const { sl, srcName } of allSlots) {
            if (sl.kind !== "component-prop" || sl.nodeId !== boundaryLocalId) continue;
            const propName = sl.propKey.startsWith("component.") ? sl.propKey.slice("component.".length) : sl.propKey;
            if (srcName !== void 0) {
              props[propName] = opts.read(srcName);
            } else {
              const impl = evaluators.get(sl.evaluatorId);
              if (impl) {
                try {
                  props[propName] = impl({ read: opts.read });
                } catch {
                  props[propName] = void 0;
                }
              }
            }
          }
        }
        const childRead = (n) => {
          if (Object.prototype.hasOwnProperty.call(props, n)) return props[n];
          const d = def.data;
          if (d && Object.prototype.hasOwnProperty.call(d, n)) return d[n];
          return opts.read(n);
        };
        const ctx = { read: childRead };
        const childRegistry = opts.registry ? new ListRegistry() : void 0;
        const childOffset = nextId;
        const childInst = instantiateTemplate(def.template, {
          viewport: opts.viewport,
          read: childRead,
          table: def.table,
          registry: childRegistry,
          idOffset: idOffset + childOffset,
          components: opts.components,
          componentDepth: depth + 1
        });
        const contentRoots = nodes.filter((x) => x.parentId === boundary.id && x.slotFor);
        if (contentRoots.length > 0 || childInst.slotMounts?.length) {
          const fills = /* @__PURE__ */ new Map();
          const scopeOf = /* @__PURE__ */ new Map();
          const bindingsOf = /* @__PURE__ */ new Map();
          for (const r of contentRoots) {
            const sf = r.slotFor;
            const arr = fills.get(sf.name) ?? [];
            arr.push(r);
            fills.set(sf.name, arr);
            if (!scopeOf.has(sf.name)) scopeOf.set(sf.name, sf.scope);
            if (!bindingsOf.has(sf.name)) bindingsOf.set(sf.name, sf.scopeBindings);
          }
          const childEvaluators = def.table ? VaporRuntime.buildEvaluators(def.table.evaluators) : /* @__PURE__ */ new Map();
          const evalOutletProps = (outlet) => {
            const out = {};
            const names = outlet.slotOutlet.props ?? [];
            const outletLocal = outlet.id - (idOffset + childOffset);
            const allSlots = def.table ? [...def.table.sources.flatMap((s) => s.slots), ...def.table.constantSlots ?? []] : [];
            for (const propName of names) {
              const sl = allSlots.find((s) => s.nodeId === outletLocal && s.propKey === `attr.${propName}`);
              if (!sl) continue;
              const impl = childEvaluators.get(sl.evaluatorId);
              if (!impl) continue;
              try {
                out[propName] = impl({ read: childRead });
              } catch {
                out[propName] = void 0;
              }
            }
            return out;
          };
          const { consumed, placed } = dissolveOutlets(childInst.nodes, fills, evalOutletProps);
          for (const p of placed) {
            const scopeVar = scopeOf.get(p.name);
            const scopeBindings = bindingsOf.get(p.name);
            if (!scopeVar && !scopeBindings) continue;
            const rootIds = new Set(p.fill.map((x) => x.id));
            const byIdOfChild = new Map(childInst.nodes.map((x) => [x.id, x]));
            const subtree = [];
            for (const x of childInst.nodes) {
              let cur = x;
              let guard = 0;
              while (cur !== void 0 && guard++ < 64) {
                if (rootIds.has(cur.id)) {
                  subtree.push(x);
                  break;
                }
                cur = cur.parentId === null ? void 0 : byIdOfChild.get(cur.parentId);
              }
            }
            const scopedRead = (n2) => {
              if (scopeVar && n2 === scopeVar) return p.props;
              if (scopeBindings) {
                const hit = scopeBindings.find((b) => b.local === n2);
                if (hit) return p.props[hit.key];
              }
              return opts.read(n2);
            };
            const scopeTag = scopeVar ?? scopeBindings.map((b) => b.local).join(",");
            for (const node of subtree) {
              const tn = tpl.nodes.find((x) => x.id === node.id - idOffset);
              if (tn?.textSegments && tn.textSegments.length > 0) {
                node.text = evalTextSegments(tn.textSegments, scopedRead);
              }
            }
            let appliedScoped = 0;
            for (const sc of opts.table?.slotScopedSlots ?? []) {
              if (scopeVar !== void 0 ? sc.scope !== scopeVar : !scopeBindings.some((b) => b.local === sc.scope)) continue;
              const target = subtree.find((x) => x.id === sc.nodeId + idOffset);
              if (!target) continue;
              const impl = evaluators.get(sc.evaluatorId);
              if (!impl) continue;
              const f = engineFieldOf(sc.propKey);
              if (!f) continue;
              let v;
              try {
                v = impl({ read: scopedRead });
              } catch {
                continue;
              }
              if (f.kind === "text") {
                target.text = v === void 0 || v === null ? "" : String(v);
              } else {
                applyStyleField(target, sc.propKey, f.key, v, opts.table?.classRules);
              }
              appliedScoped++;
              valuesFilled++;
            }
            instNotes.push(
              `\u63D2\u69FD ${name}#${p.name}\uFF1A\u4F5C\u7528\u57DF ${scopeVar ? `\`${scopeVar}\`` : `\u89E3\u6784 \`{ ${scopeBindings.map((b) => b.local).join(", ")} }\``} \u7ED1\u5B9A\u51FA\u53E3 props ${JSON.stringify(p.props)}\uFF08\u6587\u672C\u6BB5\u91CD\u6C42\u503C ${subtree.filter((x) => tpl.nodes.find((t) => t.id === x.id - idOffset)?.textSegments?.length).length} \u8282\u70B9 \xB7 \u4F5C\u7528\u57DF\u6837\u5F0F ${appliedScoped} \u5904\uFF09`
            );
          }
          for (const [nm, roots] of fills) {
            if (consumed.has(nm)) {
              for (const r of roots) {
                const i = nodes.indexOf(r);
                if (i >= 0) nodes.splice(i, 1);
              }
              continue;
            }
            for (const r of roots) {
              const doomed = subtreeOf(nodes, r.id);
              for (const id of doomed) droppedNodeIds.add(id);
              for (let i = nodes.length - 1; i >= 0; i--) if (doomed.has(nodes[i].id)) nodes.splice(i, 1);
            }
            instNotes.push(`\u63D2\u69FD ${name}#${nm} \u7684\u5185\u5BB9\u65E0\u51FA\u53E3\u63A5\u4F4F\uFF08\u5B50\u7EC4\u4EF6\u6CA1\u6709\u540C\u540D <slot>\uFF09\u21D2 \u672A\u6E32\u67D3`);
          }
        }
        for (const r of childInst.nodes) if (r.parentId === null) r.parentId = boundary.id;
        nodes.push(...childInst.nodes);
        componentNodes += childInst.nodes.length;
        valuesFilled += childInst.stats.valuesFilled;
        nextId = childOffset + childInst.stats.maxLocalId + 1;
        componentMounts.push({
          boundaryNodeId: boundary.id,
          name,
          props,
          ctx,
          table: def.table,
          registry: childRegistry,
          nodeIds: childInst.nodes.map((x) => x.id),
          idOffset: idOffset + childOffset,
          // ★P1-3 emits：边界在**本树**的 id 空间 —— 宿主要加 idOffset 才是它看到的 id
          treeOffset: idOffset
        });
        for (const m of childInst.componentMounts ?? []) componentMounts.push(m);
        for (const sm of childInst.slotMounts ?? []) slotMounts.push(sm);
        for (const d of childInst.stats.droppedNodeIds ?? []) droppedNodeIds.add(d);
        for (const nt of childInst.notes ?? []) instNotes.push(nt);
      }
    }
    if ((opts.componentDepth ?? 0) === 0) {
      dissolveOutlets(nodes, /* @__PURE__ */ new Map());
      for (const x of nodes) {
        const rec = x;
        if (rec.slotFor !== void 0) delete rec.slotFor;
        if (rec.slotOutlet !== void 0) delete rec.slotOutlet;
      }
    }
    return {
      viewport: opts.viewport,
      nodes,
      stats: {
        reusedTemplateIds: reused,
        allocatedIds: allocated,
        rows: nodes.length,
        valuesFilled,
        // ★P1-3：本树 local 高水位（父级据此推进自己的分配器——**不含** idOffset）
        maxLocalId: nextId - 1,
        componentNodes,
        // ★P1-3 插槽分发：丢弃节点（最终 id 空间）——桥传给运行时 `skipNodeIds`
        ...droppedNodeIds.size > 0 ? { droppedNodeIds: [...droppedNodeIds] } : {}
      },
      // ★只有**恰好一个**列表时才给虚拟化描述（多个列表 ⇒ 行号空间不同源，宿主按行号二分会错配）
      virtual: virtualRows.length > 0 && tpl.lists.length === 1 ? { rows: virtualRows } : void 0,
      ...componentMounts.length > 0 ? { componentMounts } : {},
      ...slotMounts.length > 0 ? { slotMounts } : {},
      ...instNotes.length > 0 ? { notes: instNotes } : {}
    };
  }

  // packages/slot-runtime/src/dispatch.ts
  function createDispatchState() {
    return { onceFired: /* @__PURE__ */ new Set() };
  }
  var keyOf = (nodeId, event, handler) => `${nodeId}:${event}:${handler}`;
  function indexEventBindings(bindings) {
    const byNodeEvent = /* @__PURE__ */ new Map();
    for (const b of bindings) byNodeEvent.set(`${b.nodeId}:${b.event}`, b);
    return byNodeEvent;
  }
  function dispatchGesture(chain, event, index, state, run) {
    const fired = [];
    const skippedSelf = [];
    const skippedOnce = [];
    let handler = "";
    let stopped = false;
    const hit = chain.length > 0 ? chain[0] : -1;
    for (const id of chain) {
      const b = index.get(`${id}:${event}`) ?? index.get(`${id}:tap`);
      if (!b) continue;
      if (b.componentEmit) continue;
      if (b.self && id !== hit) {
        skippedSelf.push(id);
        continue;
      }
      const onceKey = keyOf(id, b.event, b.handler);
      if (b.once && state.onceFired.has(onceKey)) {
        skippedOnce.push(id);
        continue;
      }
      if (!run(b.handler, id)) continue;
      if (b.once) state.onceFired.add(onceKey);
      fired.push(id);
      if (!handler) handler = b.handler;
      if (b.stop) {
        stopped = true;
        break;
      }
    }
    return { fired, handler, stopped, skippedSelf, skippedOnce };
  }

  // packages/slot-runtime/src/directives.ts
  var HOST_DIRECTIVE_SPECS = {
    animate: {
      argKind: "anim-preset",
      argHint: "\u52A8\u753B\u9884\u8BBE\uFF08fade / slide-up / slide-down / slide-left / slide-right / zoom / fade-slide-up\uFF09",
      desc: "\u503C\u53D8\u5316\uFF08\u6216\u9996\u6B21\u6C42\u503C\u4E3A\u771F\uFF09\u65F6\u5728\u8BE5\u8282\u70B9**\u64AD\u4E00\u6B21**\u9884\u8BBE\u52A8\u753B\uFF08\u8D70\u5185\u6838\u52A8\u753B\u901A\u9053\uFF0C\u4E0E <Transition> \u540C\u4E00\u5957\uFF09\u3002\u8BED\u4E49\u5BF9\u9F50\uFF1A\u6307\u4EE4\u7684 mounted\uFF08\u9996\u8BC4 truthy \u5373\u64AD\uFF09\u4E0E updated\uFF08\u503C\u53D8\u5316\u5373\u64AD\uFF09\u3002"
    }
  };
  var HOST_DIRECTIVE_NAMES = Object.keys(HOST_DIRECTIVE_SPECS);
  function directiveShouldPlay(prev, cur, seen) {
    if (!seen) return Boolean(cur);
    return !Object.is(prev, cur) && Boolean(cur);
  }

  // packages/renderer-app/dist/index.js
  var import_runtime_core = __toESM(require_runtime_core(), 1);
  function createAppHostConfig(adapter) {
    return {
      // ★view/原生标签 → 原生视图容器
      createElement(type) {
        return adapter.createElement(type);
      },
      createText(text) {
        return adapter.createText(text);
      },
      createComment() {
        return adapter.createComment();
      },
      setText(node, text) {
        adapter.setText(node, text);
      },
      setElementText(el, text) {
        adapter.setElementText(el, text);
      },
      insert(child, parent, anchor) {
        adapter.insert(child, parent, anchor);
      },
      remove(node) {
        adapter.remove(node);
      },
      parentNode(node) {
        return adapter.parentNode(node);
      },
      nextSibling() {
        return null;
      },
      patchProp(el, key, prev, next) {
        adapter.patchProp(el, key, prev, next);
      },
      querySelector() {
        return null;
      },
      setScopeId() {
      },
      cloneNode() {
        return adapter.createComment();
      },
      insertStaticContent() {
        const c = adapter.createComment();
        return [c, c];
      }
    };
  }
  function createAppRenderer(adapter) {
    return (0, import_runtime_core.createRenderer)(createAppHostConfig(adapter));
  }

  // packages/renderer-app/dist/adapters/selfdraw.js
  var PAINT_KEYS = /* @__PURE__ */ new Set(["backgroundColor", "color", "fontSize", "fontWeight", "fontFamily", "borderRadius", "borderColor", "borderWidth", "opacity"]);
  var LAYOUT_KEYS = /* @__PURE__ */ new Set([
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "margin",
    "padding",
    "flexDirection",
    "justifyContent",
    "alignItems",
    "alignSelf",
    "flexGrow",
    "flexShrink",
    "flexBasis",
    "gap",
    "display",
    "position",
    "top",
    "left",
    "overflow",
    // ★★2026-10-01：**内核动画的静态基态**（C1 `clipPath` / B 批 `perspective`）——
    //   它们不改几何（不是"布局属性"），但**必须随请求进内核**：裁剪形状是复位目标、
    //   透视距离是 3D 参数。⇒ 放进"进核心"的键集（请求构造按本集合过滤）。
    //   ★若漏放：请求里不带声明 ⇒ 内核拒绝裁剪动画 / 3D 无透视，且**静默**
    //     （首次接通时真机实测：`clip_rejected` 的原因正是"树里未声明 clipPath"）。
    "clipPath",
    "perspective",
    // ★★C2（2026-10-01）：SVG 描边三键同属"内核动画的静态基态"（路径本体 / 描边色 / 线宽）。
    //   ★与 clipPath 同款教训：不在本集合 ⇒ 请求不带声明 ⇒ 描边动画被拒且静默。
    "svgPath",
    "strokeColor",
    "strokeWidth",
    // ★★渐变（v1 静态 paint——2026-10-01）：宿主绘制属性（与 borderRadius 同层）。
    //   ★本集合是"请求树"的筛选器（内核 + iOS 宿主共读这棵树）——
    //     漏放 ⇒ **iOS 宿主的建层读不到声明 ⇒ 静默不渲染**（对内核则无害：它不算渐变）。
    "fillGradient",
    // ★★渐变 v2：B 态（混合终点）——漏放 ⇒ 请求不带 B ⇒ 内核拒绝混合动画且静默
    "fillGradientTo",
    // ★★路径变形 v1：B 态（变形终点）——同款纪律（漏放 ⇒ 内核拒绝变形动画）
    "svgPathTo",
    // ★★发光 v1（glow）：静态规格（色/半径/强度）——漏放 ⇒ 宿主不发光且静默
    "glow",
    // ★★软边遮罩 v1（mask）：静态规格——漏放 ⇒ 宿主无遮罩且静默
    "mask",
    // ★★变换原点 v1（transformOrigin）：漏放 ⇒ 所有旋转绕中心（"绕错点转"最难查）
    "transformOrigin"
  ]);
  function foldLength(v) {
    if (typeof v === "number") return Number.isFinite(v) ? { dp: v } : void 0;
    if (typeof v !== "string") return void 0;
    const s = v.trim();
    const pct = /^(-?[\d.]+)%$/.exec(s);
    if (pct) {
      const n = Number(pct[1]);
      return Number.isFinite(n) ? { ratio: n / 100 } : void 0;
    }
    const px = /^(-?[\d.]+)(px)?$/.exec(s);
    if (px) {
      const n = Number(px[1]);
      return Number.isFinite(n) ? { dp: n } : void 0;
    }
    return void 0;
  }
  function layoutStyleOf(props) {
    const flat = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === "style" && v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(flat, v);
      } else {
        flat[k] = v;
      }
    }
    const out = {};
    for (const [key, value] of Object.entries(flat)) {
      if (!LAYOUT_KEYS.has(key)) continue;
      if (key === "clipPath" || key === "perspective" || key === "svgPath" || key === "strokeColor" || key === "strokeWidth" || key === "fillGradient" || key === "fillGradientTo" || key === "svgPathTo" || key === "glow" || key === "mask" || key === "transformOrigin") {
        out[key] = value;
        continue;
      }
      if (key === "margin" || key === "padding") {
        const e = foldEdges(value);
        if (e) out[key] = e;
        continue;
      }
      if (key === "width" || key === "height" || key === "minWidth" || key === "maxWidth" || key === "minHeight" || key === "maxHeight" || key === "flexBasis" || key === "top" || key === "left" || key === "gap") {
        const f = foldLength(value);
        if (!f) continue;
        if ("ratio" in f) {
          if (key === "width" || key === "height") out[key === "width" ? "widthRatio" : "heightRatio"] = f.ratio;
        } else {
          out[key] = f.dp;
        }
        continue;
      }
      if (key === "flexGrow" || key === "flexShrink") {
        if (typeof value === "number") out[key] = value;
        continue;
      }
      if (typeof value === "string" || typeof value === "number") out[key] = value;
    }
    return out;
  }
  function styleSig(v) {
    if (!v || typeof v !== "object") return "";
    const layout = layoutStyleOf(v);
    const keys = Object.keys(layout).sort();
    const parts = [];
    for (const k of keys) {
      const val = layout[k];
      if (val && typeof val === "object") {
        const sub = Object.keys(val).sort().map((sk) => `${sk}:${val[sk]}`).join(",");
        parts.push(`${k}{${sub}}`);
      } else {
        parts.push(`${k}:${val}`);
      }
    }
    return parts.join("|");
  }
  function normalizeFontWeight(v) {
    if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : void 0;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "normal") return 400;
      if (t === "bold") return 700;
      if (t === "bolder") return 700;
      if (t === "lighter") return 300;
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return void 0;
  }
  var DEFAULT_FONT_WEIGHT = 400;
  var CUSTOM_FONT_PREFIX = "custom:";
  var DEFAULT_FONT_FAMILY = "system";
  function normalizeFontFamily(v) {
    if (typeof v !== "string") return void 0;
    const rawList = v.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const candidates = rawList.map((s) => s.toLowerCase());
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (c === "system" || c === "system-ui" || c === "-apple-system" || c === "sans-serif" || c === "sans") return "system";
      if (c === "serif" || c.includes("serif") && !c.includes("sans")) return "serif";
      if (c === "monospace" || c === "mono") return "monospace";
      if (c.includes("rounded")) return "rounded";
      if (c.includes("condensed")) return "condensed";
      if (c.includes("georgia") || c.includes("times") || c.includes("songti") || c.includes("\u5B8B")) return "serif";
      if (c.includes("menlo") || c.includes("consolas") || c.includes("courier") || c.includes("mono")) return "monospace";
      if (c === "helvetica" || c === "roboto" || c === "arial" || c === "pingfang" || c.includes("pingfang")) return "system";
    }
    const first = rawList[0];
    return first ? CUSTOM_FONT_PREFIX + first : void 0;
  }
  function fontSignature(fontSize, fontWeight, fontFamily) {
    let h = 2166136261;
    const mix = (s) => {
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      h ^= 31;
      h = Math.imul(h, 16777619);
    };
    mix(String(Math.round(fontSize * 100)));
    mix(String(Math.round(fontWeight)));
    mix(fontFamily);
    return h >>> 0 || 1;
  }
  function styleValue(style, camelKey) {
    if (!style) return void 0;
    const v = style[camelKey];
    if (v !== void 0) return v;
    const kebab = camelKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return style[kebab];
  }
  function paintOf(props) {
    const styleObj = props.style && typeof props.style === "object" && !Array.isArray(props.style) ? props.style : void 0;
    const out = {};
    for (const k of PAINT_KEYS) {
      const v = styleValue(styleObj, k) ?? props[k];
      if (v === void 0 || v === null) {
        out[k] = null;
        continue;
      }
      if (k === "backgroundColor" || k === "color" || k === "borderColor") {
        out[k] = typeof v === "string" ? v : null;
        continue;
      }
      if (k === "fontWeight") {
        const w = normalizeFontWeight(v);
        out[k] = w === void 0 ? null : w;
        continue;
      }
      if (k === "fontFamily") {
        const fam = normalizeFontFamily(v);
        out[k] = fam ?? null;
        continue;
      }
      out[k] = typeof v === "number" ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : null;
    }
    return out;
  }
  function deriveSpecPaintHint(spec) {
    const opaque = (c) => {
      if (c === void 0 || c === null) return false;
      const t = c.trim().toLowerCase();
      if (t === "" || t === "transparent") return false;
      if (/^#[0-9a-f]{3}$/.test(t) || /^#[0-9a-f]{6}$/.test(t)) return true;
      if (/^#[0-9a-f]{4}$/.test(t)) return t[4] === "f";
      if (/^#[0-9a-f]{8}$/.test(t)) return t.slice(7) === "ff";
      const m = /^rgba?\(([^)]*)\)$/.exec(t);
      if (m !== null) {
        const p = m[1].split(",").map((x) => x.trim());
        if (p.length === 3) return true;
        if (p.length === 4) {
          const a = Number(p[3]);
          return Number.isFinite(a) && a >= 1;
        }
      }
      return false;
    };
    const neutral = (c) => {
      if (c === void 0 || c === null) return false;
      const t = c.trim().toLowerCase();
      let r, g, b;
      const h3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]?$/.exec(t);
      const h6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(t);
      if (h3 !== null) {
        r = parseInt(h3[1] + h3[1], 16);
        g = parseInt(h3[2] + h3[2], 16);
        b = parseInt(h3[3] + h3[3], 16);
      } else if (h6 !== null) {
        r = parseInt(h6[1], 16);
        g = parseInt(h6[2], 16);
        b = parseInt(h6[3], 16);
      } else {
        const m = /^rgba?\(([^)]*)\)$/.exec(t);
        if (m === null) return false;
        const p = m[1].split(",").map((x) => Number(x.trim()));
        if (p.length < 3 || !p.slice(0, 3).every((n) => Number.isFinite(n))) return false;
        r = p[0];
        g = p[1];
        b = p[2];
      }
      return r === g && g === b;
    };
    const hasText = typeof spec.text === "string" && spec.text.length > 0;
    const opacityIsOne = spec.opacity === void 0 || spec.opacity === 1;
    const hasRadius = spec.borderRadius !== void 0 && spec.borderRadius !== 0;
    const hasBorder = spec.borderWidth !== void 0 && spec.borderWidth !== 0;
    return {
      isMonochrome: !!(hasText && opaque(spec.color) && neutral(spec.color) && spec.backgroundColor === void 0 && !hasRadius && opacityIsOne),
      isPureBackground: !!(opaque(spec.backgroundColor) && !hasBorder && !hasRadius && !hasText && opacityIsOne)
    };
  }
  function paintSig(v) {
    if (!v || typeof v !== "object") return "";
    const paint = paintOf(v);
    return Object.keys(paint).sort().map((k) => `${k}:${String(paint[k])}`).join("|");
  }
  function normalizeEventType(key) {
    if (!key.startsWith("on") || key.length <= 2) return null;
    const raw = key.slice(2);
    const lower = raw.charAt(0).toLowerCase() + raw.slice(1);
    const noCapture = lower.endsWith("Capture") ? lower.slice(0, -"Capture".length) : lower;
    if (!noCapture) return null;
    if (noCapture === "click") return "tap";
    return noCapture.toLowerCase();
  }
  function foldEdges(v) {
    if (typeof v === "number" || typeof v === "string") {
      const one = foldLength(v);
      if (!one || !("dp" in one)) return void 0;
      return { top: one.dp, right: one.dp, bottom: one.dp, left: one.dp };
    }
    if (v && typeof v === "object") {
      const o = v;
      const out = {};
      for (const side of ["top", "right", "bottom", "left"]) {
        const f = foldLength(o[side]);
        if (f && "dp" in f) out[side] = f.dp;
      }
      return out;
    }
    return void 0;
  }
  function createSelfDrawAdapter() {
    let nextNodeId = 1;
    const idOf = /* @__PURE__ */ new WeakMap();
    const root = { __kind: "element", tag: "root", props: {}, children: [], parent: null };
    idFor(root);
    let elements = 0;
    let texts = 0;
    let patches = 0;
    function idFor(node) {
      let id = idOf.get(node);
      if (id === void 0) {
        id = nextNodeId++;
        idOf.set(node, id);
      }
      return id;
    }
    const dirty = /* @__PURE__ */ new Set();
    const textDirty = /* @__PURE__ */ new Map();
    const paintDirty = /* @__PURE__ */ new Set();
    const handlers = /* @__PURE__ */ new Map();
    let structuralChange = false;
    const parentOf = /* @__PURE__ */ new WeakMap();
    let movedExisting = false;
    const createdNodes = /* @__PURE__ */ new Set();
    const removedNodeIds = /* @__PURE__ */ new Set();
    const unknownKeys = /* @__PURE__ */ new Map();
    const parentNodeOf = (node) => node.__kind === "element" ? node.parent : null;
    function fillSpec(spec, node) {
      const props = node.__kind === "element" ? node.props : {};
      if (node.__kind === "text") {
        spec.text = node.text;
        const tStyle = props.style && typeof props.style === "object" && !Array.isArray(props.style) ? props.style : {};
        const ls = foldLength(tStyle.lineHeight ?? props.lineHeight);
        if (ls && "dp" in ls) spec.height = ls.dp;
        const parent = node.__kind === "text" ? parentOf.get(node) ?? null : null;
        const pStyle = parent && parent.props.style && typeof parent.props.style === "object" && !Array.isArray(parent.props.style) ? parent.props.style : void 0;
        const fs = styleValue(tStyle, "fontSize") ?? props.fontSize ?? styleValue(pStyle, "fontSize") ?? (parent ? parent.props.fontSize : void 0);
        const fsNum = typeof fs === "number" ? fs : typeof fs === "string" ? Number(fs.replace(/px$/i, "")) : NaN;
        const fwRaw = styleValue(tStyle, "fontWeight") ?? props.fontWeight ?? styleValue(pStyle, "fontWeight") ?? (parent ? parent.props.fontWeight : void 0);
        const fwNum = normalizeFontWeight(fwRaw) ?? DEFAULT_FONT_WEIGHT;
        const famRaw = styleValue(tStyle, "fontFamily") ?? props.fontFamily ?? styleValue(pStyle, "fontFamily") ?? (parent ? parent.props.fontFamily : void 0);
        const famRole = normalizeFontFamily(famRaw) ?? DEFAULT_FONT_FAMILY;
        if (Number.isFinite(fsNum) && fsNum > 0) {
          spec.fontSize = fsNum;
          spec.fontWeight = fwNum;
          spec.fontFamily = famRole;
          spec.textStyleKey = fontSignature(fsNum, fwNum, famRole);
        }
        const col = styleValue(tStyle, "color") ?? props.color ?? styleValue(pStyle, "color") ?? (parent ? parent.props.color : void 0);
        if (typeof col === "string") spec.color = col;
        spec.paintHint = deriveSpecPaintHint({
          text: spec.text,
          color: spec.color,
          backgroundColor: spec.backgroundColor,
          borderRadius: spec.borderRadius,
          borderWidth: spec.borderWidth,
          opacity: spec.opacity
        });
        return;
      }
      if (node.__kind !== "element") return;
      const flat = {};
      for (const [k, v] of Object.entries(props)) {
        if (k === "style" && v && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(flat, v);
        } else {
          flat[k] = v;
        }
      }
      const pStyleObj = props.style && typeof props.style === "object" && !Array.isArray(props.style) ? props.style : void 0;
      Object.assign(spec, layoutStyleOf(props));
      {
        const bgRaw = styleValue(pStyleObj, "backgroundColor") ?? props.backgroundColor;
        if (typeof bgRaw === "string" && bgRaw.length > 0) spec.backgroundColor = bgRaw;
      }
      for (const key of PAINT_KEYS) {
        const src = styleValue(pStyleObj, key) ?? props[key];
        if (key === "backgroundColor" || key === "color") {
          if (typeof src === "string") spec[key] = src;
        } else if (key === "fontWeight") {
          const w = normalizeFontWeight(src);
          if (w !== void 0) spec.fontWeight = w;
        } else if (key === "fontFamily") {
          const fam = normalizeFontFamily(src);
          if (fam !== void 0) spec.fontFamily = fam;
        } else {
          const n = typeof src === "number" ? src : typeof src === "string" ? Number(src.replace(/px$/i, "")) : NaN;
          if (Number.isFinite(n)) spec[key] = n;
        }
      }
      spec.paintHint = deriveSpecPaintHint({
        text: spec.text,
        color: spec.color,
        backgroundColor: spec.backgroundColor,
        borderRadius: spec.borderRadius,
        borderWidth: spec.borderWidth,
        opacity: spec.opacity
      });
    }
    function walk(node, parentId, viewport, out) {
      if (node.__kind === "comment") return;
      const id = idFor(node);
      const spec = { id, parentId };
      fillSpec(spec, node);
      out.push(spec);
      if (node.__kind === "element") for (const child of node.children) walk(child, id, viewport, out);
    }
    return {
      root,
      createElement(tag) {
        elements++;
        const n = { __kind: "element", tag, props: {}, children: [], parent: null };
        idFor(n);
        structuralChange = true;
        createdNodes.add(n);
        return n;
      },
      createText(text) {
        texts++;
        const n = { __kind: "text", text };
        idFor(n);
        structuralChange = true;
        createdNodes.add(n);
        return n;
      },
      createComment() {
        return { __kind: "comment" };
      },
      setText(node, text) {
        if (node.text !== text) {
          node.text = text;
          textDirty.set(node, text);
        }
        patches++;
      },
      setElementText(el, text) {
        const only = el.children.length === 1 ? el.children[0] : null;
        if (only && only.__kind === "text") {
          if (only.text !== text) {
            only.text = text;
            textDirty.set(only, text);
            patches++;
          }
          return;
        }
        for (const c of el.children) {
          if (c.__kind === "element" || c.__kind === "text") {
            const cid = idFor(c);
            removedNodeIds.add(cid);
            handlers.delete(cid);
          }
          parentOf.delete(c);
        }
        el.children = [];
        const t = this.createText(text);
        parentOf.set(t, el);
        el.children.push(t);
        patches++;
      },
      insert(child, parent, anchor) {
        const prevParent = parentOf.get(child) ?? (child.__kind === "element" ? child.parent : null);
        if (parentOf.has(child) || child.__kind === "element" && child.parent) {
          movedExisting = true;
        }
        if (prevParent) {
          const pi = prevParent.children.indexOf(child);
          if (pi >= 0) prevParent.children.splice(pi, 1);
        }
        parentOf.set(child, parent);
        if (child.__kind === "element") child.parent = parent;
        if (anchor === null) {
          parent.children.push(child);
        } else {
          const idx = parent.children.indexOf(anchor);
          parent.children.splice(idx < 0 ? parent.children.length : idx, 0, child);
        }
        structuralChange = true;
        patches++;
      },
      remove(node) {
        const parent = parentOf.get(node) ?? parentNodeOf(node);
        if (parent) {
          const idx = parent.children.indexOf(node);
          if (idx >= 0) parent.children.splice(idx, 1);
        }
        parentOf.delete(node);
        const removedId = idOf.get(node);
        if (removedId !== void 0) handlers.delete(removedId);
        paintDirty.delete(node);
        structuralChange = true;
        if (node.__kind === "element" || node.__kind === "text") removedNodeIds.add(idFor(node));
        patches++;
      },
      parentNode: (node) => parentOf.get(node) ?? parentNodeOf(node),
      patchProp(el, key, prev, next) {
        if (key === "textContent") {
          if (next !== null && next !== void 0) this.setElementText(el, String(next));
          return;
        }
        if (key.startsWith("on")) {
          const type = normalizeEventType(key);
          if (type) {
            const id = idFor(el);
            let m = handlers.get(id);
            if (!m) {
              m = /* @__PURE__ */ new Map();
              handlers.set(id, m);
            }
            if (next === null || next === void 0) m.delete(type);
            else m.set(type, next);
          }
          patches++;
          return;
        }
        if (next === null || next === void 0) delete el.props[key];
        else el.props[key] = next;
        const prevSig = styleSig(key === "style" ? prev : {});
        const nextSig = styleSig(key === "style" ? next : {});
        if (key === "style") {
          if (prevSig !== nextSig) dirty.add(el);
        } else if (LAYOUT_KEYS.has(key)) {
          if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) dirty.add(el);
        }
        if (key === "style") {
          if (paintSig(prev ?? {}) !== paintSig(next ?? {})) paintDirty.add(el);
        } else if (PAINT_KEYS.has(key)) {
          if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) paintDirty.add(el);
        }
        patches++;
      },
      toRequest(viewport) {
        const nodes = [];
        walk(root, null, viewport, nodes);
        return { viewport, nodes };
      },
      /**
       * ★★V7：产出**结构变更请求**（供 `proteus_layout_splice`）——增删行的增量路径
       *
       * 【为什么值得做（本仓实测的量化依据）】此前结构变化一律**重发整棵树**
       *   （真机 S5：500→600 项 **230ms**，几乎全是搬运成本）。
       *   而增删行在长列表里是最常见的交互（加载更多 / 删除一行）。
       *
       * 【返回形态】`null` = 无结构变更；否则给出 splice 请求（removes/inserts）。
       *
       * 【★只支持**追加**（架构限制的显式暴露）】核心的 `build_taffy` 按 `tree.nodes` 的
       *   **数组顺序**连父子（忽略 `children` 排列）⇒ 想插到中间必须同时搬数组（O(n)）。
       *   ⇒ 本函数**检测**新建节点的落点是否都在父的**末尾**：
       *     · 全是追加 ⇒ 返回 splice 请求（走增量）
       *     · 含中间插入 ⇒ 返回 `'full-required'`（调用方走全量——**不静默按末尾插**，
       *       否则行序错且零提示：本仓纪律「宁可拒绝不可静默错」）
       */
      takeSplice() {
        const removed0 = Array.from(removedNodeIds);
        const created0 = Array.from(createdNodes);
        const moved = movedExisting;
        removedNodeIds.clear();
        createdNodes.clear();
        movedExisting = false;
        structuralChange = false;
        if (moved) return "full-required";
        const createdSet0 = new Set(created0);
        const removedSet0 = new Set(removed0);
        const created = created0.filter((n) => !removedSet0.has(idFor(n)));
        const removed = removed0.filter((id) => {
          const n = created0.find((c) => idFor(c) === id);
          return n === void 0 || !createdSet0.has(n);
        });
        if (removed.length === 0 && created.length === 0) return null;
        if (created.length === 0) return { removes: removed, inserts: [] };
        const createdSet = new Set(created);
        const byParent = /* @__PURE__ */ new Map();
        for (const n of created) {
          const p = parentOf.get(n) ?? (n.__kind === "element" ? n.parent : null);
          if (!p) continue;
          if (createdSet.has(p)) continue;
          const arr = byParent.get(p) ?? [];
          arr.push(n);
          byParent.set(p, arr);
        }
        const groups = [];
        for (const [parent, kids] of byParent) {
          const kidsSet = new Set(kids);
          const idxs = [];
          for (let i = 0; i < parent.children.length; i++) {
            if (kidsSet.has(parent.children[i])) idxs.push(i);
          }
          if (idxs.length !== kids.length) return "full-required";
          const first = idxs[0];
          for (let k = 0; k < idxs.length; k++) {
            if (idxs[k] !== first + k) return "full-required";
          }
          groups.push({ parent, kids, index: first });
        }
        if (groups.length === 0 && removed.length === 0) return null;
        const inserts = [];
        for (const g of groups) {
          const flat = [];
          const walkSub = (n, parentId) => {
            if (n.__kind === "comment") return;
            const id = idFor(n);
            const spec = { id, parentId };
            fillSpec(spec, n);
            flat.push(spec);
            if (n.__kind === "element") for (const c of n.children) walkSub(c, id);
          };
          for (const k of g.kids) walkSub(k, idFor(g.parent));
          inserts.push({ parentId: idFor(g.parent), index: g.index, nodes: flat });
        }
        return { removes: removed, inserts };
      },
      dispatchEvent(nodeId, chain, type, x, y, extra) {
        const fired = [];
        const errors = [];
        let stoppedAt = null;
        const order = chain.length > 0 ? chain : [nodeId];
        for (const id of order) {
          const h = handlers.get(id)?.get(type);
          if (!h) continue;
          const ev = {
            type,
            target: nodeId,
            currentTarget: id,
            x,
            y,
            // ★语义附加字段（swipe.direction 等——与 packages/gesture 的 GestureEvent 同形状）
            ...extra ?? {},
            _stopped: false,
            stopPropagation() {
              ev._stopped = true;
            }
          };
          try {
            h(ev);
          } catch (e) {
            errors.push(`node ${id} handler(${type}) \u629B\u51FA\uFF1A${String(e?.message ?? e)}`);
          }
          fired.push(id);
          if (ev._stopped) {
            stoppedAt = id;
            break;
          }
        }
        return { fired, stoppedAt, errors };
      },
      takePatches() {
        const structural = structuralChange;
        structuralChange = false;
        const batch = Array.from(dirty);
        dirty.clear();
        const textBatch = Array.from(textDirty);
        textDirty.clear();
        if (structural) return null;
        const out = [];
        for (const node of batch) {
          const el = node;
          const id = idOf.get(node);
          if (id === void 0) continue;
          const style = layoutStyleOf(el.props);
          if (Object.keys(style).length > 0) out.push({ id, style });
        }
        for (const [node, text] of textBatch) {
          const id = idOf.get(node);
          if (id === void 0) continue;
          out.push({ id, style: { text } });
        }
        return out;
      },
      takePaintPatches() {
        const batch = Array.from(paintDirty);
        paintDirty.clear();
        const out = [];
        for (const node of batch) {
          const id = idOf.get(node);
          if (id === void 0) continue;
          out.push({ id, paint: paintOf(node.props ?? {}) });
        }
        return out;
      },
      markFullSync: () => {
        structuralChange = false;
        dirty.clear();
        createdNodes.clear();
        removedNodeIds.clear();
        movedExisting = false;
        textDirty.clear();
        paintDirty.clear();
      },
      patchCount: () => patches,
      createdCount: () => ({ elements, texts }),
      resetStats: () => {
        patches = 0;
        elements = 0;
        texts = 0;
        unknownKeys.clear();
      },
      /** 未知键清单（诊断；也可由验收断言为空） */
      unknownKeys: () => Object.fromEntries(unknownKeys)
    };
  }

  // hosts/android/bridge/entry-vapor.ts
  var import_runtime_core3 = __toESM(require_runtime_core(), 1);

  // hosts/android/bridge/vapor-ab-render.generated.ts
  var import_runtime_core2 = __toESM(require_runtime_core(), 1);
  function render(_ctx, _cache) {
    const _component_p_text = (0, import_runtime_core2.resolveComponent)("p-text");
    const _component_p_view = (0, import_runtime_core2.resolveComponent)("p-view");
    const _component_KidPanel = (0, import_runtime_core2.resolveComponent)("KidPanel");
    const _component_MyKeep = (0, import_runtime_core2.resolveComponent)("MyKeep");
    return (0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(_component_p_view, { style: { "width": 1080, "height": 1600, "flexDirection": "column", "padding": { "top": 24 }, "backgroundColor": "#14141c" } }, {
      default: (0, import_runtime_core2.withCtx)(() => [
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 20, "color": "#ffffff", "margin": { "bottom": 12 } } }, {
          default: (0, import_runtime_core2.withCtx)(() => [..._cache[8] || (_cache[8] = [
            (0, import_runtime_core2.createTextVNode)(
              "Vapor \xB7 \u8BBE\u5907\u7AEF",
              -1
              /* CACHED */
            )
          ])]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 90, "margin": { "bottom": 8 }, "borderRadius": 18, "backgroundColor": "#2a3f66" } }),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 90, "margin": { "bottom": 8 }, "fillGradient": { "kind": "linear", "angle": 90, "stops": [{ "offset": 0, "color": "#7c5cff" }, { "offset": 1, "color": "#ff9a6c" }] } } }),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 90, "margin": { "bottom": 8 }, "backgroundColor": "#1f2c44", "glow": { "color": "#fff6d8", "radius": 26, "alpha": 0.9 } } }),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 90, "margin": { "bottom": 8 }, "backgroundColor": "#24405e", "clipPath": { "kind": "inset", "params": [0, 0, 0.45, 0] } } }),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 80, "margin": { "bottom": 8 }, "backgroundColor": "#16203a", "svgPath": { "d": "M16 64 Q 270 8 524 64", "stroke": "#cfe0ff", "strokeWidth": 7, "progress": 1 } } }),
        ((0, import_runtime_core2.openBlock)(true), (0, import_runtime_core2.createElementBlock)(
          import_runtime_core2.Fragment,
          null,
          (0, import_runtime_core2.renderList)(_ctx.list, (item) => {
            return (0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(
              _component_p_view,
              {
                key: item.id,
                style: { "height": 44, "margin": { "bottom": 6 }, "backgroundColor": "#285ac8" }
              },
              {
                default: (0, import_runtime_core2.withCtx)(() => [
                  (0, import_runtime_core2.createCommentVNode)(' \u2605\u2605\u6DF7\u5408\u6587\u672C\uFF08P2-2\uFF0C2026-10-03\uFF09\uFF1A\u9759\u6001\u6BB5 + \u4E24\u4E2A\u63D2\u503C\u6BB5 \u21D2 \u8FD0\u884C\u65F6\u6C42\u503C\u62FC\u63A5\u3002\n           \u5224\u636E\u6838\u7684\u662F**\u5B8C\u6574\u4E32**\uFF08"row-1\xB7row 1"\uFF09\u771F\u7684\u5230\u4E86\u5185\u6838\uFF08text_probe\uFF09\uFF0C\n           \u4EE5\u53CA\u6539\u6570\u636E\u540E\u91CD\u53D1\u7684 SET_TEXT \u4ECD\u662F\u5B8C\u6574\u4E32\uFF08\u4E0D\u662F\u53EA\u5269\u4E00\u4E2A\u5B57\u6BB5\uFF09\u3002 '),
                  (0, import_runtime_core2.createVNode)(_component_p_text, {
                    width: item.w,
                    style: { "fontSize": 12, "color": "#ffffff" }
                  }, {
                    default: (0, import_runtime_core2.withCtx)(() => [
                      (0, import_runtime_core2.createTextVNode)(
                        "row-" + (0, import_runtime_core2.toDisplayString)(item.id) + "\xB7" + (0, import_runtime_core2.toDisplayString)(item.title),
                        1
                        /* TEXT */
                      )
                    ]),
                    _: 2
                    /* DYNAMIC */
                  }, 1032, ["width"])
                ]),
                _: 2
                /* DYNAMIC */
              },
              1024
              /* DYNAMIC_SLOTS */
            );
          }),
          128
          /* KEYED_FRAGMENT */
        )),
        (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 30, "margin": { "top": 10 }, "backgroundColor": "#6a4bf0" } }),
        (0, import_runtime_core2.createVNode)(_component_p_view, {
          width: _ctx.padW,
          onClick: _cache[1] || (_cache[1] = ($event) => _ctx.padW += 5),
          style: { "height": 96, "margin": { "top": 8 }, "backgroundColor": "#1c2b3f" }
        }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createVNode)(_component_p_view, {
              width: _ctx.boxW,
              onClick: _cache[0] || (_cache[0] = ($event) => _ctx.boxW += 30),
              style: { "height": 56, "margin": { "top": 8 }, "backgroundColor": "#2f6fed" }
            }, null, 8, ["width"])
          ]),
          _: 1
          /* STABLE */
        }, 8, ["width"]),
        (0, import_runtime_core2.createCommentVNode)(' \u2605\u2605\u4E8B\u4EF6\u4FEE\u9970\u7B26\u5939\u5177\uFF08P2-3\uFF0C2026-10-03\uFF09\uFF1A\u5916\u5C42 @click\uFF08\u65E0\u4FEE\u9970\uFF09+ \u5185\u5C42 @click.stop\u3002\n         **\u5185\u5C42\u523B\u610F\u4E0D\u906E\u4F4F\u5916\u5C42\u7684\u4E2D\u5FC3**\uFF08\u5185\u5C42 40px \u8D34\u9876\uFF0C\u5916\u5C42 220px \u21D2 \u5916\u5C42\u4E2D\u5FC3 y=110 \u5728\u5185\u5C42\u4E4B\u5916\uFF09\n         \u2014\u2014\u5BBF\u4E3B\u6CE8\u5165 tap \u662F\u6309"\u8282\u70B9\u4E2D\u5FC3"\u70B9\u7684\uFF1A\u82E5\u91CD\u53E0\uFF0C\u70B9\u5916\u5C42\u4E5F\u4F1A\u547D\u4E2D\u5185\u5C42 \u21D2 \u5224\u636E\u62FF\u4E0D\u5230\n         \u300C\u7956\u5148 handler \u672C\u4F1A\u8DD1\u3001\u4F46\u88AB .stop \u6321\u4E0B\u300D\u7684\u8BC1\u636E\u3002 '),
        (0, import_runtime_core2.createVNode)(_component_p_view, {
          width: _ctx.stopOuterW,
          onClick: _cache[3] || (_cache[3] = ($event) => _ctx.stopOuterW += 5),
          style: { "height": 220, "margin": { "top": 8 }, "backgroundColor": "#223344" }
        }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createVNode)(_component_p_view, {
              width: _ctx.stopInnerW,
              onClick: _cache[2] || (_cache[2] = _withModifiers(($event) => _ctx.stopInnerW += 30, ["stop"])),
              style: { "height": 40, "backgroundColor": "#445566" }
            }, null, 8, ["width"])
          ]),
          _: 1
          /* STABLE */
        }, 8, ["width"]),
        (0, import_runtime_core2.createCommentVNode)(' \u2605\u2605P2-5\uFF082026-10-03\uFF09\uFF1Av-once \u51BB\u7ED3 / v-memo \u7EC4\u95E8 \u5939\u5177\u3002\n         \xB7 once \u884C\uFF1A{{ onceVal }} \u53EA\u5728\u9996\u5E27\u5199\uFF0C\u4E4B\u540E**\u6E90\u600E\u4E48\u6539\u90FD\u4E0D\u518D\u5199**\uFF08\u5224\u636E \u246A \u7528\uFF09\uFF1B\n         \xB7 memo \u884C\uFF1Av-memo="[memoDep]" + {{ memoVal }} \u2014\u2014 \u6539 memoVal\uFF08\u4F9D\u8D56\u51C0\uFF09\u21D2 **\u8DF3\u8FC7**\u3001\n                     \u6539 memoDep\uFF08\u4F9D\u8D56\u810F\uFF09\u21D2 \u653E\u884C\uFF08\u628A\u6700\u65B0 memoVal \u5199\u4E0B\u53BB\uFF09\u3002\n         \u2605\u4E24\u884C\u7684\u6587\u672C\u521D\u503C\u523B\u610F\u53EF\u533A\u5206\uFF08once-x / memo-y\uFF09\uFF0C\u5224\u636E\u6838"\u8DF3\u8FC7"\u4E0E"\u653E\u884C"\u7684**\u4E0D\u540C**\u7ED3\u679C\u3002 '),
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "once-" + (0, import_runtime_core2.toDisplayString)(_ctx.onceVal),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        }),
        _cache[4] || ((0, import_runtime_core2.setBlockTracking)(-1, true), (_cache[4] = (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "once-" + (0, import_runtime_core2.toDisplayString)(_ctx.onceVal),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        })).cacheIndex = 4, (0, import_runtime_core2.setBlockTracking)(1), _cache[4]),
        (0, import_runtime_core2.withMemo)([_ctx.memoDep], () => ((0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(_component_p_text, {
          key: "memo",
          style: { "fontSize": 12, "color": "#ffffff" }
        }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "memo-" + (0, import_runtime_core2.toDisplayString)(_ctx.memoVal),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        })), _cache, 5),
        (0, import_runtime_core2.createCommentVNode)(` \u2605\u2605P2-6~P2-9\uFF082026-10-03\uFF09\uFF1A
         \xB7 v-text\uFF08P2-6\uFF09\uFF1A\u4E0E\u63D2\u503C\u540C\u69FD\u4F4D\uFF1B
         \xB7 \u767D\u540D\u5355\u7EAF\u51FD\u6570\uFF08P2-8\uFF09\uFF1AMath.round / String \u7B49 + Math.PI \u7F16\u8BD1\u671F\u5185\u8054\uFF08\u6B64\u524D\u9759\u9ED8\u6E32\u67D3\u6210\u7A7A\uFF09\uFF1B
         \xB7 \u7EAF\u65B9\u6CD5\uFF08P2-8 \u7EED\uFF09\uFF1Aarr.join\uFF08\u771F\u5B9E\u9879\u76EE\u7528\u6CD5\uFF09\uFF1B
         \xB7 \u53EF\u9009\u94FE\uFF08P2-9\uFF09\uFF1Aobj?.x \u7F16\u8BD1\u671F\u964D\u7EA7\u4E3A cond \u7A0B\u5E8F\uFF08\u7A7A\u503C \u21D2 \u7A7A\u4E32\uFF0C\u4E0D\u662F 'undefined'\uFF09\u3002
         \u5224\u636E \u246B \u6838\uFF1A\u8FD9\u4E9B\u8282\u70B9\u7684**\u9996\u5E27\u6587\u672C**\u662F\u6C42\u503C\u7ED3\u679C\uFF08\u4E0D\u662F\u7A7A\u4E32\u3001\u4E5F\u4E0D\u662F "undefined"/"null" \u5B57\u9762\u91CF\uFF09\u3002 `),
        (0, import_runtime_core2.createVNode)(_component_p_text, {
          textContent: (0, import_runtime_core2.toDisplayString)("vt-" + _ctx.exprA),
          style: { "fontSize": 12, "color": "#ffffff" }
        }, null, 8, ["textContent"]),
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "pi-" + (0, import_runtime_core2.toDisplayString)(Math.PI.toFixed(2)),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "mx-" + (0, import_runtime_core2.toDisplayString)(Math.max(_ctx.exprA, 7)),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "jn-" + (0, import_runtime_core2.toDisplayString)(_ctx.exprArr.join("|")),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "fontSize": 12, "color": "#ffffff" } }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createTextVNode)(
              "oc-" + (0, import_runtime_core2.toDisplayString)(_ctx.exprObj?.inner),
              1
              /* TEXT */
            )
          ]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605\u2605P3-3\uFF082026-10-03\uFF09Transition \u6865\u63A5\u5939\u5177\uFF1A**\u5916\u5C42 Transition \u900F\u4F20**\uFF08\u4E0D\u5360\u8282\u70B9 id\u3001\n         \u4E0D\u4EA7\u5305\u88F9\u76D2\uFF09+ \u5185\u5C42\u5143\u7D20\u5E26 v-show\uFF08\u53EF\u89C1\u6027\u5207\u6362\u662F\u8FC7\u6E21\u7684\u9A71\u52A8\u6E90\uFF09\u3002\n         \u5224\u636E \u246C \u6838\uFF1A\u53EF\u89C1\u6027\u7FFB\u8F6C\u540E transition_started \u5927\u4E8E 0\uFF08\u52A8\u753B\u771F\u7684\u4EA4\u7ED9\u4E86\u5BBF\u4E3B\uFF09\u3002\n         \u2605\u672C\u6CE8\u91CA**\u4E0D\u5F97**\u542B\u53CD\u5F15\u53F7\u6216\u7F8E\u5143\u82B1\u62EC\u53F7\uFF08\u5B83\u5728 JS \u6A21\u677F\u4E32\u91CC\u2014\u2014\u672C\u4ED3\u5DF2\u8E29\u56DB\u6B21\uFF09\u3002 "),
        (0, import_runtime_core2.createVNode)(import_runtime_core2.Transition, {
          name: "fade-slide-up",
          persisted: ""
        }, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.withDirectives)((0, import_runtime_core2.createVNode)(
              _component_p_view,
              { style: { "height": 40, "backgroundColor": "#7c5cff" } },
              null,
              512
              /* NEED_PATCH */
            ), [
              [import_runtime_core2.vShow, _ctx.trVisible]
            ])
          ]),
          _: 1
          /* STABLE */
        }),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605\u2605P1-3\uFF082026-10-03\uFF09\u7EC4\u4EF6\u5185\u90E8\u6E32\u67D3\u5939\u5177\uFF1AKids \u5B50\u7EC4\u4EF6\uFF08\u6784\u5EFA\u671F\u7F16\u8BD1\u6210 ComponentDef\uFF09+\n         props \u7ED1**\u54CD\u5E94\u5F0F\u6E90**\uFF08kidLabelW / kidLabel\uFF09\u21D2 \u5224\u636E\u6838\u300C\u7236\u6539 props \u21D2 \u5B50\u8282\u70B9\u771F\u7684\u66F4\u65B0\u300D\u3002\n         \u2605\u5E95\u8272\u907F\u5F00 #2f6fed\uFF08A/B \u5224\u636E\u7684\u6309\u94AE\u8272\u951A\uFF09\u3002 "),
        (0, import_runtime_core2.createVNode)(_component_KidPanel, {
          label: _ctx.kidLabel,
          labelW: _ctx.kidLabelW,
          onBump: _cache[6] || (_cache[6] = ($event) => _ctx.bumpTotal = $event + 100),
          style: { "height": 30 }
        }, null, 8, ["label", "labelW"]),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605\u2605P1-3 emits\uFF082026-10-03\uFF09\uFF1A\u4E0A\u9762 @bump \u76D1\u542C\u5B50\u7EC4\u4EF6 $emit\uFF1B\u672C\u8282\u70B9\u662F**\u51E0\u4F55\u951A**\u2014\u2014\n         \u5BBD\u5EA6\u7ED1 bumpTotal\uFF08\u521D\u59CB 0 \u21D2 \u51E0\u4F55 0 \u5BBD\uFF09\uFF0C\u5224\u636E\u6838\u300C\u5B50 emit \u21D2 \u7236 handler \u8DD1 \u21D2 **\u5185\u6838\u51E0\u4F55\u771F\u53D8**\u300D\u3002\n         \u2605\u4E3A\u4EC0\u4E48\u7528\u5BBD\u5EA6\u800C\u4E0D\u662F\u6587\u672C\uFF08\u672C\u4ED3\u5224\u636E\u53E3\u5F84\uFF09\uFF1A\u6587\u672C\u6539\u52A8\u53EF\u80FD\u88AB\u6587\u672C\u540C\u6B65\u94FE\u8DEF\u63A9\u76D6\uFF1B\u51E0\u4F55\u662F\u5185\u6838\u771F\u503C\u3002 "),
        (0, import_runtime_core2.createVNode)(_component_p_view, {
          width: _ctx.bumpTotal,
          style: { "height": 6, "backgroundColor": "#3aa0ff" }
        }, null, 8, ["width"]),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605\u2605P1-3 \u751F\u547D\u5468\u671F\uFF082026-10-03\uFF09\uFF1Avue:mounted \u6A21\u677F\u94A9\u5B50\u2014\u2014\u9996\u5E27 mount \u540E\u89E6\u53D1\u52A8\u4F5C\u8868\n         \uFF08\u6539 lifeW \u21D2 \u8D70\u8BA2\u9605 \u2192 \u6307\u4EE4 \u2192 \u5185\u6838\u91CD\u6392\uFF09\u3002\u672C\u8282\u70B9\u662F**\u51E0\u4F55\u951A**\uFF08\u5BBD\u7ED1 lifeW\uFF0C\u521D\u503C 0\uFF09\u3002\n         \u2605\u4E3A\u4EC0\u4E48\u7528\u5BBD\u5EA6\uFF1A\u6587\u672C\u6539\u52A8\u53EF\u80FD\u88AB\u6587\u672C\u540C\u6B65\u94FE\u8DEF\u63A9\u76D6\uFF1B\u51E0\u4F55\u662F\u5185\u6838\u771F\u503C\u3002 "),
        (0, import_runtime_core2.createVNode)(_component_p_view, {
          onVnodeMounted: _cache[7] || (_cache[7] = ($event) => _ctx.lifeW = 250),
          width: _ctx.lifeW,
          style: { "height": 6, "backgroundColor": "#ff9a6c" }
        }, null, 8, ["width"]),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605\u2605P3 \u6279\u6B21\uFF082026-10-03\uFF09\u903B\u8F91\u5BB9\u5668**\u900F\u4F20**\u5939\u5177\uFF1A\u4E09\u8005\u90FD**\u4E0D\u4EA7\u5305\u88F9\u76D2**\n         \uFF08Vue \u8BED\u4E49\uFF1A\u903B\u8F91\u5BB9\u5668\u4E0D\u6E32\u67D3\u5143\u7D20\uFF09\u2014\u2014\u5224\u636E\u6838\u300C\u8282\u70B9\u6570\u5B88\u6052 + \u51E0\u4F55\u4E0E Vue \u7B49\u4EF7\u300D\u3002\n         \u2605\u672C\u6CE8\u91CA\u4E0D\u5F97\u542B\u53CD\u5F15\u53F7\u6216\u7F8E\u5143\u82B1\u62EC\u53F7\uFF08\u5728 JS \u6A21\u677F\u4E32\u91CC\u2014\u2014\u62A4\u680F\u89C1 check:script-compile\uFF09\u3002 "),
        (0, import_runtime_core2.createCommentVNode)(" \u2605\u2605KeepAlive \u7684\u5B98\u65B9\u7EA6\u675F\uFF08\u672C\u4ED3\u5B9E\u6D4B\u88AB Vue \u7F16\u8BD1\u5668\u5F53\u573A\u62E6\u4E0B\uFF09\uFF1A\u5B83\u8981\u6C42\u300C\u6070\u597D\u4E00\u4E2A\u5B50\u7EC4\u4EF6\u300D\n         \u2014\u2014p-view\uFF08\u539F\u751F\u6807\u7B7E\uFF09\u4F1A\u88AB\u62D2\uFF1ASyntaxError: KeepAlive expects exactly one child component.\n         \u21D2 \u5939\u5177\u6539\u7528\u771F\u7EC4\u4EF6\u5F62\u6001\uFF08MyKeep\uFF09\u9A8C\u8BC1\u900F\u4F20\u3002\n         \u2605\u5E95\u8272\u907F\u5F00 #2f6fed\uFF08A/B \u5224\u636E\u7684\u6309\u94AE\u8272\u951A\u2014\u2014\u672C\u4ED3\u5DF2\u8E29\uFF1A\u91CD\u590D \u21D2 \u5224\u636E\u7EA2\uFF09\u3002 "),
        ((0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(
          import_runtime_core2.KeepAlive,
          null,
          [
            (0, import_runtime_core2.createVNode)(_component_MyKeep, null, {
              default: (0, import_runtime_core2.withCtx)(() => [
                (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 20, "backgroundColor": "#4a5f8a" } })
              ]),
              _: 1
              /* STABLE */
            })
          ],
          1024
          /* DYNAMIC_SLOTS */
        )),
        ((0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(import_runtime_core2.Teleport, { to: "#nowhere" }, [
          (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 20, "backgroundColor": "#6f4ae8" } })
        ])),
        ((0, import_runtime_core2.openBlock)(), (0, import_runtime_core2.createBlock)(import_runtime_core2.Suspense, null, {
          default: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createVNode)(_component_p_view, { style: { "height": 20, "backgroundColor": "#1b2a4a" } })
          ]),
          fallback: (0, import_runtime_core2.withCtx)(() => [
            (0, import_runtime_core2.createVNode)(_component_p_text, { style: { "color": "#ffffff" } }, {
              default: (0, import_runtime_core2.withCtx)(() => [..._cache[9] || (_cache[9] = [
                (0, import_runtime_core2.createTextVNode)(
                  "suspense-fallback",
                  -1
                  /* CACHED */
                )
              ])]),
              _: 1
              /* STABLE */
            })
          ]),
          _: 1
          /* STABLE */
        }))
      ]),
      _: 1
      /* STABLE */
    });
  }
  var modifierGuards = {
    stop: (e) => {
      if (typeof e.stopPropagation === "function") e.stopPropagation();
    },
    prevent: (e) => {
      if (typeof e.preventDefault === "function") e.preventDefault();
    },
    self: (e) => e.target !== e.currentTarget,
    ctrl: (e) => !e.ctrlKey,
    shift: (e) => !e.shiftKey,
    alt: (e) => !e.altKey,
    meta: (e) => !e.metaKey,
    left: (e) => "button" in e && e.button !== 0,
    middle: (e) => "button" in e && e.button !== 1,
    right: (e) => "button" in e && e.button !== 2,
    exact: (e, modifiers) => ["ctrl", "shift", "alt", "meta"].some((m) => e[m + "Key"] && !modifiers.includes(m))
  };
  var withModifiers = (fn, modifiers) => {
    if (!fn) return fn;
    const cache = fn._withMods || (fn._withMods = {});
    const cacheKey = modifiers.join(".");
    return cache[cacheKey] || (cache[cacheKey] = (event, ...args) => {
      for (const m of modifiers) {
        const guard = modifierGuards[m];
        if (guard && guard(event, modifiers)) return;
      }
      return fn(event, ...args);
    });
  };
  var _withModifiers = withModifiers;

  // hosts/android/bridge/entry-vapor.ts
  function makeData(rows) {
    return {
      list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 40 + i % 5 * 12, title: `row ${i + 1}` })),
      // ★与夹具 script 的 `ref(120)` 一致：**初始数据必须给全**，否则 `:width="boxW"` 首帧是 0，
      //   tap 后变 30 的"对比基线"是零宽（几何差异虽真但语义不清——数据与声明要对齐）
      boxW: 120,
      // ★★冒泡锚（2026-10-02）：按钮外层容器的宽度源——容器上的 `@click="padW += 5"`
      //   是**祖先 handler**：tap 链 [按钮, 容器, root] 上两跳都要跑（判据核"链没断"）
      padW: 300,
      // ★★P2-3 修饰符夹具（2026-10-03）：内层 `@click.stop` 的宽度源 + 外层（无修饰）的宽度源
      //   ——判据 ⑨ 核"点了内层，**外层 handler 不许跑**"（.stop 真的终止了冒泡）
      stopOuterW: 300,
      stopInnerW: 120,
      // ★★P2-5 夹具（2026-10-03）：once 冻结 / memo 组门——判据 ⑪ 用（见 runShort 的更新轮）
      onceVal: 1,
      memoDep: 0,
      memoVal: 1,
      // ★★P2-6~P2-9 夹具（2026-10-03）：表达式能力（判据 ⑫ 核首帧文本）
      exprA: 3,
      exprArr: ["a", "b"],
      exprObj: { inner: "ok" },
      // ★P3-3 夹具：初始**不可见** ⇒ 判据里改 true ⇒ 触发入场过渡（见 drainTransitions）
      trVisible: false,
      // ★★★P1-3 夹具（组件 props 源——判据改它们验"父改 ⇒ 子更新"）
      kidLabel: "k0",
      kidLabelW: 40,
      tapCount: 0,
      // ★★★P1-3 emits（2026-10-03）：子组件 @bump 的父级落点源（判据核"子 emit ⇒ 父 handler ⇒ 几何"）
      bumpTotal: 0,
      // ★★★P1-3 生命周期（2026-10-03）：@vue:mounted 动作的落点源（初值 0 ⇒ 挂载后变 250）
      lifeW: 0
    };
  }
  function __proteusVaporRun(argsJson) {
    const args = JSON.parse(argsJson);
    if (args.mode === "list") return runVirtualList(args);
    if (args.mode === "ab") return runAb(args);
    if (args.mode === "stress") return runStress(args);
    return runShort(args);
  }
  function runStress(args) {
    const notes = [];
    const rep = {
      ok: false,
      tpl_nodes: 0,
      sub_l1: 0,
      inst_nodes: 0,
      inst_texts: 0,
      inst_rows: 0,
      data_rows: 0,
      mount_ms: 0,
      host_layout_ms: -1,
      host_measure_ms: -1,
      host_cmds: -1,
      painted_samples: -1,
      painted_colors: -1,
      viewport: "",
      first_node_style: null,
      anchor_rect: null,
      notes
    };
    try {
      const artifacts = JSON.parse(args.artifacts);
      if (!artifacts.tpl.ok) {
        rep.error = "\u6A21\u677F\u4E0D\u53EF\u7528\uFF08\u6784\u5EFA\u671F\u8BCA\u65AD\uFF09";
        return JSON.stringify(rep);
      }
      rep.tpl_nodes = artifacts.tpl.nodes.length;
      rep.sub_l1 = artifacts.table.stats.l1;
      const data = artifacts.data ?? {};
      const listArr = Array.isArray(data.list) ? data.list : [];
      rep.data_rows = listArr.length;
      rep.src = "examples/pages/consistency-stress.vue";
      const read = (n) => data[n];
      const registry = new ListRegistry();
      const t0 = Date.now();
      const inst = instantiateTemplate(artifacts.tpl, {
        viewport: args.viewport,
        read,
        table: artifacts.table,
        registry
      });
      rep.mount_ms = Date.now() - t0;
      rep.inst_nodes = inst.nodes.length;
      rep.inst_rows = inst.virtual?.rows.length ?? 0;
      rep.inst_texts = inst.nodes.filter((n) => typeof n.text === "string" && String(n.text).length > 0).length;
      const first = inst.nodes[0];
      rep.first_node_style = first?.style ?? null;
      rep.viewport = `${args.viewport.width}x${args.viewport.height}`;
      const mountOut = JSON.parse(
        proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
      );
      if (mountOut.ok !== true) {
        rep.error = "\u5BBF\u4E3B mount \u5931\u8D25\uFF1A" + (mountOut.error ?? "");
        return JSON.stringify(rep);
      }
      rep.host_layout_ms = mountOut.layout_ms ?? -1;
      rep.host_measure_ms = mountOut.measure_ms ?? -1;
      rep.host_cmds = mountOut.cmds ?? -1;
      rep.painted_samples = mountOut.painted_samples ?? -1;
      rep.painted_colors = mountOut.painted_colors ?? -1;
      const anchorRect = readRectsByOrder([1]);
      rep.anchor_rect = anchorRect.length > 0 ? [anchorRect[0].x, anchorRect[0].y, anchorRect[0].width, anchorRect[0].height] : null;
      rep.ok = rep.inst_nodes > 0 && rep.data_rows > 0;
      notes.push("\u516D\u7AEF SFC \u538B\u529B\u5939\u5177\uFF08Android\uFF09\uFF1A\u6E32\u67D3 examples/pages/consistency-stress.vue \u7684\u7F16\u8BD1\u4EA7\u7269");
      notes.push("\u6570\u636E\u6765\u81EA\u6784\u5EFA\u671F\u5FEB\u7167\uFF08extractStressData\uFF09\u2014\u2014\u4E0E Web/MP \u7AEF script \u5B57\u9762\u91CF\u540C\u6E90");
      return JSON.stringify(rep);
    } catch (e) {
      rep.error = String(e?.message ?? e);
      return JSON.stringify(rep);
    }
  }
  function runAb(args) {
    const t = () => Date.now();
    const rows = Math.max(1, args.rows ?? 8);
    const notes = [];
    const rep = {
      ok: false,
      nodes_a: 0,
      nodes_b: 0,
      texts_a: 0,
      texts_b: 0,
      samples: 0,
      max_delta: -1,
      mismatches: -1,
      first_mismatch: null,
      cost_a: { instantiate_ms: 0, host_ms: 0, total_ms: 0 },
      cost_b: { vue_ms: 0, request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0 },
      layout_ms_a: -1,
      layout_ms_b: -1,
      channels_a: -1,
      channels_b: -1,
      chan_a: null,
      chan_b: null,
      chan_match: false,
      ev_a: null,
      ev_b: null,
      ev_match: false,
      ev_before_delta: -1,
      ev_after_delta: -1,
      upd_rounds: 0,
      upd_a: [],
      upd_b: [],
      upd_samples: 0,
      upd_max_delta: -1,
      upd_mismatches: -1,
      upd_first_mismatch: null,
      upd_geom_rounds: [],
      upd_a_text_synced: 0,
      upd_b_text_applied: 0,
      notes
    };
    try {
      const artifacts = JSON.parse(args.artifacts);
      if (!artifacts.tpl.ok) {
        rep.error = "\u6A21\u677F\u4E0D\u53EF\u7528\uFF08\u6784\u5EFA\u671F\u8BCA\u65AD\uFF09";
        return JSON.stringify(rep);
      }
      const data = JSON.parse(JSON.stringify(abData));
      const dataB = JSON.parse(JSON.stringify(abData));
      const read = (n2) => data[n2];
      const registry = new ListRegistry();
      const tA0 = t();
      const inst = instantiateTemplate(artifacts.tpl, { viewport: args.viewport, read, table: artifacts.table, registry });
      const textNodesAForAb = inst.nodes.filter((n2) => typeof n2.text === "string" && n2.text.length > 0).map((n2) => ({ id: Number(n2.id), text: String(n2.text) }));
      const tA1 = t();
      rep.nodes_a = inst.nodes.length;
      rep.texts_a = inst.nodes.filter((n2) => typeof n2.text === "string" && n2.text.length > 0).length;
      const mountA = JSON.parse(
        proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
      );
      const tA2 = t();
      rep.cost_a = { instantiate_ms: tA1 - tA0, host_ms: tA2 - tA1, total_ms: tA2 - tA0 };
      rep.layout_ms_a = mountA.layout_ms ?? -1;
      if (mountA.ok !== true) {
        rep.error = "A \u8DEF mount \u5931\u8D25\uFF1A" + (mountA.error ?? "");
        return JSON.stringify(rep);
      }
      const semIdsA = textNodesAForAb.map((n2) => n2.id);
      const rectsA = readRectsByOrder(semIdsA);
      const chARaw = probeChannelsRaw(inst.nodes.map((n2) => Number(n2.id)));
      const updRounds = Math.max(0, args.updates ?? 2);
      const updA = [];
      const geomsA = [];
      const keys = new PropKeyTable();
      const strings = new StringPool();
      const captured = [];
      const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes));
      const evals = VaporRuntime.buildEvaluators(artifacts.table.evaluators);
      const vapor = new VaporRuntime(artifacts.table, slotRt, evals, registry);
      const ctx = { read };
      const triggers = /* @__PURE__ */ new Map();
      vapor.load(ctx, (name, cb) => triggers.set(name, cb));
      vapor.relink(ctx);
      slotRt.flush();
      captured.length = 0;
      if (updRounds > 0) {
        for (let r = 0; r < updRounds; r++) {
          const list = data.list;
          if (!Array.isArray(list) || list.length === 0) break;
          const at = r % Math.min(list.length, rows);
          list[at].title = `upd ${r}`;
          list[at].w = 60 + r % 4 * 20;
          data.boxW = 150 + 30 * r;
          const to = t();
          triggers.get("list")?.();
          triggers.get("boxW")?.();
          slotRt.flush();
          const opsMs = t() - to;
          const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
          captured.length = 0;
          let changedN = 0;
          let relayout = -1;
          let tsyn = 0;
          let layoutMs = -1;
          const ta = t();
          if (payload.length > 0) {
            const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload))));
            if (ao.ok === true) {
              changedN = ao.rects ? Object.keys(ao.rects).length : ao.changed ?? 0;
              relayout = ao.relayout ?? -1;
              tsyn = ao.text_synced ?? 0;
              layoutMs = ao.layout_ms ?? -1;
            }
            if (ao.unsupported && ao.unsupported.length > 0) {
              notes.push(`A \u8F6E ${r}\uFF1A\u5185\u6838\u62D2\u6536 ${ao.unsupported.length} \u6761\uFF1A${JSON.stringify(ao.unsupported).slice(0, 200)}`);
            }
          }
          const applyMs = t() - ta;
          const geom = readRectsByOrder(semIdsA);
          geomsA.push(geom);
          const prevGeom = r === 0 ? rectsA : geomsA[r - 1];
          updA.push({
            round: r,
            ops_bytes: payload.length,
            ops_ms: opsMs,
            apply_ms: applyMs,
            changed_rects: changedN,
            relayout,
            layout_ms: layoutMs,
            text_synced: tsyn,
            moved: maxGeomDelta(prevGeom, geom)
          });
          rep.upd_a_text_synced += tsyn;
        }
      }
      const harnessEvents = artifacts.events ?? [];
      const harnessHandlers = artifacts.handlers ?? {};
      const byNodeEvent = indexEventBindings(harnessEvents);
      const dispatchStateA = createDispatchState();
      const GESTURE_CB = "__proteusVaporGesture";
      if (typeof proteusHost.onGesture === "function") proteusHost.onGesture(GESTURE_CB);
      const runActions = (name, store) => {
        const acts = harnessHandlers[name];
        if (!acts) return false;
        for (const a of acts) {
          const v = evalExpr(a.program, { read: (n2) => store[n2] });
          const cur = store[a.source];
          if (a.op === "set") {
            store[a.source] = v;
          } else {
            const base = typeof cur === "number" && Number.isFinite(cur) ? cur : 0;
            const delta = typeof v === "number" && Number.isFinite(v) ? v : 0;
            store[a.source] = base + delta;
          }
        }
        return true;
      };
      const readRectOf = (id) => {
        try {
          const r = JSON.parse(proteusHost.readRects());
          return r.rects?.[String(id)] ?? null;
        } catch {
          return null;
        }
      };
      const readRectsAll = () => {
        try {
          const r = JSON.parse(proteusHost.readRects());
          return r.rects ?? {};
        } catch {
          return {};
        }
      };
      const rectDelta = (a, b) => {
        if (!a || !b) return -1;
        return Math.round(Math.max(
          Math.abs(a.x - b.x),
          Math.abs(a.y - b.y),
          Math.abs(a.width - b.width),
          Math.abs(a.height - b.height)
        ) * 1e3) / 1e3;
      };
      const btnANode = inst.nodes.find((n2) => n2.backgroundColor === "#2f6fed");
      const tapBtnA = btnANode ? { nodeId: Number(btnANode.id) } : void 0;
      if (tapBtnA && typeof proteusHost.tapAt === "function") {
        const av = {
          node: tapBtnA.nodeId,
          hit: -1,
          chain: [],
          fired: [],
          fired_width_deltas: [],
          handler: "",
          ops_bytes: 0,
          applied: -1,
          relayout: -1,
          changed_rects: 0,
          before: null,
          after: null,
          width_delta: 0,
          tap_ms: 0
        };
        globalThis[GESTURE_CB] = (type, nodeId, chainJson) => {
          const chain = parseChain(chainJson, nodeId);
          const hit = dispatchChainA(chain, type, byNodeEvent, dispatchStateA, (h) => runActions(h, data));
          const handler = hit.handler;
          if (!handler) return JSON.stringify({ ok: false, reason: `\u94FE ${chain.join(">")} \u4E0A\u6CA1\u6709 ${type} \u7684 handler` });
          for (const [, cb] of triggers) cb();
          vapor.relink(ctx);
          slotRt.flush();
          const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
          captured.length = 0;
          let applied = -1;
          let relayout = -1;
          let changed = 0;
          if (payload.length > 0) {
            const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload))));
            applied = ao.ok ? ao.applied ?? -1 : -2;
            relayout = ao.relayout_count ?? ao.relayout ?? -1;
            changed = ao.rects ? Object.keys(ao.rects).length : 0;
          }
          av.handler = handler;
          av.fired = hit.fired;
          av.chain = chain;
          av.ops_bytes = payload.length;
          av.applied = applied;
          av.relayout = relayout;
          av.changed_rects = changed;
          return JSON.stringify({ ok: true, handler, fired: hit.fired, ops: payload.length, applied, relayout, changed_rects: changed });
        };
        av.before = readRectOf(tapBtnA.nodeId);
        const rectsAllBeforeA = readRectsAll();
        const tTap = t();
        if (av.before) {
          const c = { x: av.before.x + av.before.width / 2, y: av.before.y + av.before.height / 2 };
          const tp = JSON.parse(proteusHost.tapAt(JSON.stringify(c)));
          if (tp.gestures_fired === 1) {
            av.hit = tp.last?.target ?? -1;
          } else {
            notes.push(`\u2605A \u8DEF tap \u672A\u89E6\u53D1\u624B\u52BF\uFF08gestures_fired=${tp.gestures_fired ?? "\u7F3A\u5931"}\uFF09\u2014\u2014hit \u8BFB\u6570\u4E0D\u53EF\u4FE1`);
          }
        }
        av.tap_ms = t() - tTap;
        av.after = readRectOf(tapBtnA.nodeId);
        if (av.before && av.after) av.width_delta = Math.round((av.after.width - av.before.width) * 1e3) / 1e3;
        const rectsAllAfterA = readRectsAll();
        av.fired_width_deltas = av.fired.map((id) => {
          const b = rectsAllBeforeA[String(id)];
          const a2 = rectsAllAfterA[String(id)];
          return b && a2 ? Math.round((a2.width - b.width) * 1e3) / 1e3 : -999;
        });
        rep.ev_a = av;
        if (av.hit !== tapBtnA.nodeId) {
          notes.push(`\u2605A \u8DEF tap \u547D\u4E2D ${av.hit} \u2260 \u4E8B\u4EF6\u8282\u70B9 ${tapBtnA.nodeId}\uFF08hitTest \u4E0E\u4E8B\u4EF6\u7ED1\u5B9A\u4E0D\u4E00\u81F4\uFF09`);
        }
      }
      const adapter = createSelfDrawAdapter();
      const renderer = createAppRenderer(adapter);
      const container = adapter.createElement("p-view");
      adapter.root.children.push(container);
      container.parent = adapter.root;
      const abList = (0, import_runtime_core3.ref)(dataB.list);
      const abBoxW = (0, import_runtime_core3.ref)(dataB.boxW);
      const abPadW = (0, import_runtime_core3.ref)(dataB.padW);
      const abStopOuterW = (0, import_runtime_core3.ref)(dataB.stopOuterW);
      const abStopInnerW = (0, import_runtime_core3.ref)(dataB.stopInnerW);
      const abOnceVal = (0, import_runtime_core3.ref)(dataB.onceVal);
      const abMemoDep = (0, import_runtime_core3.ref)(dataB.memoDep);
      const abMemoVal = (0, import_runtime_core3.ref)(dataB.memoVal);
      const abExprA = (0, import_runtime_core3.ref)(dataB.exprA);
      const abExprArr = (0, import_runtime_core3.ref)(dataB.exprArr);
      const abExprObj = (0, import_runtime_core3.ref)(dataB.exprObj);
      const abTrVisible = (0, import_runtime_core3.ref)(dataB.trVisible);
      const abBumpTotal = (0, import_runtime_core3.ref)(dataB.bumpTotal);
      const abLifeW = (0, import_runtime_core3.ref)(dataB.lifeW);
      let abRootInst = null;
      const AbApp = {
        name: "VaporAbApp",
        setup() {
          abRootInst = (0, import_runtime_core3.getCurrentInstance)();
          return {
            list: abList,
            boxW: abBoxW,
            padW: abPadW,
            stopOuterW: abStopOuterW,
            stopInnerW: abStopInnerW,
            onceVal: abOnceVal,
            memoDep: abMemoDep,
            memoVal: abMemoVal,
            exprA: abExprA,
            exprArr: abExprArr,
            exprObj: abExprObj,
            trVisible: abTrVisible,
            bumpTotal: abBumpTotal,
            lifeW: abLifeW
          };
        },
        render
      };
      const tB0 = t();
      renderer.createApp(AbApp).mount(container);
      const tB1 = t();
      const req = adapter.toRequest(args.viewport);
      const tB2 = t();
      const treeJson = JSON.stringify(req);
      const tB3 = t();
      const mountB = JSON.parse(proteusHost.mount(treeJson));
      const tB4 = t();
      rep.cost_b = {
        vue_ms: tB1 - tB0,
        request_ms: tB2 - tB1,
        serialize_ms: tB3 - tB2,
        host_ms: tB4 - tB3,
        total_ms: tB4 - tB0
      };
      rep.layout_ms_b = mountB.layout_ms ?? -1;
      if (mountB.ok !== true) {
        rep.error = "B \u8DEF mount \u5931\u8D25\uFF1A" + (mountB.error ?? "");
        return JSON.stringify(rep);
      }
      adapter.markFullSync();
      const textNodesA = textNodesAForAb;
      const textNodesBAll = req.nodes.filter(
        (n2) => typeof n2.text === "string" && n2.text.length > 0
      );
      const parentIdOf = /* @__PURE__ */ new Map();
      for (const n2 of req.nodes) {
        parentIdOf.set(Number(n2.id), n2.parentId ?? null);
      }
      const semB = textNodesBAll.map((t2) => {
        const pid = parentIdOf.get(Number(t2.id)) ?? null;
        const parent = pid !== null ? req.nodes.find((x) => Number(x.id) === pid) : void 0;
        return { text: String(t2.text), nodeId: parent ? Number(parent.id) : Number(t2.id) };
      });
      const seqA = textNodesA.map((n2) => n2.text);
      const seqB = semB.map((x) => x.text);
      const seqSame = seqA.length === seqB.length && seqA.every((t2, i) => t2 === seqB[i]);
      if (!seqSame) {
        notes.push(`\u2605\u2605\u6587\u672C\u5E8F\u5217\u4E0D\u540C\uFF08\u5BF9\u9F50\u5931\u6548\u2014\u2014\u5148\u770B\u8FD9\u4E2A\uFF09\uFF1AA=${JSON.stringify(seqA.slice(0, 6))} \xB7 B=${JSON.stringify(seqB.slice(0, 6))}`);
      }
      rep.nodes_b = req.nodes.length;
      const semIdsB = semB.map((x) => x.nodeId);
      rep.texts_b = textNodesBAll.length;
      const rectsB = readRectsByOrder(semIdsB);
      const chBRaw = probeChannelsRaw(req.nodes.map((x) => Number(x.id)));
      if (rep.nodes_a !== rep.nodes_b || rep.texts_a !== rep.texts_b || true) {
        const fmt = (ns) => ns.slice(0, 40).map((n2) => `${n2.id}${n2.parentId === null ? "" : "<" + String(n2.parentId)}:${String(n2.tag ?? "")}${typeof n2.text === "string" && n2.text ? "(" + String(n2.text).slice(0, 6) + ")" : ""}`).join(" ");
        notes.push("A \u6811: " + fmt(inst.nodes));
        notes.push("B \u6811: " + fmt(req.nodes));
        const fmt2 = (ns) => ns.slice(0, 40).map((n2) => {
          const keys2 = Object.keys(n2).filter(
            (k) => !["id", "parentId", "text"].includes(k)
          );
          return `${n2.id}<${n2.parentId ?? "-"}[${keys2.slice(0, 3).join(",")}${keys2.length > 3 ? "\u2026" : ""}]${typeof n2.text === "string" && n2.text ? "{" + String(n2.text).slice(0, 5) + "}" : ""}`;
        }).join(" ");
        notes.push("A \u660E\u7EC6: " + fmt2(inst.nodes));
        notes.push("B \u660E\u7EC6: " + fmt2(req.nodes));
      }
      if (rep.nodes_a !== rep.nodes_b) {
        notes.push(`\u2605\u8282\u70B9\u6570\u4E0D\u540C\uFF1AA=${rep.nodes_a} \xB7 B=${rep.nodes_b}\uFF08\u6811\u89C4\u6A21\u5C31\u4E0D\u4E00\u81F4\u2014\u2014\u5148\u770B\u8FD9\u4E2A\uFF09`);
      }
      const n = Math.min(rectsA.length, rectsB.length);
      let maxD = 0;
      let mism = 0;
      let first = null;
      for (let i = 0; i < n; i++) {
        const a = rectsA[i];
        const b = rectsB[i];
        if (!a || !b) continue;
        const d = Math.max(
          Math.abs(a.x - b.x),
          Math.abs(a.y - b.y),
          Math.abs(a.width - b.width),
          Math.abs(a.height - b.height)
        );
        if (d > maxD) maxD = d;
        if (d > 0.01) {
          mism++;
          if (!first) first = { index: i, id_a: a.id, id_b: b.id, rect_a: a, rect_b: b, delta: Math.round(d * 1e3) / 1e3 };
        }
      }
      rep.samples = n;
      rep.max_delta = Math.round(maxD * 1e3) / 1e3;
      rep.mismatches = mism;
      rep.first_mismatch = first;
      const sigA = channelSig(chARaw);
      const sigB = channelSig(chBRaw);
      const nonEmptyCount = (probes) => probes.filter((c) => {
        for (const k of CHANNEL_KEYS) {
          const v = c[k];
          if (v === void 0 || v === null) continue;
          if (typeof v === "number" && v !== 0) return true;
          if (typeof v === "string" && v.length > 0) return true;
        }
        return false;
      }).length;
      rep.channels_a = nonEmptyCount(chARaw);
      rep.channels_b = nonEmptyCount(chBRaw);
      rep.chan_a = sigA;
      rep.chan_b = sigB;
      rep.chan_match = JSON.stringify(sigA) === JSON.stringify(sigB);
      const updB = [];
      const geomsB = [];
      if (updRounds > 0) {
        const listB = abList.value;
        for (let r = 0; r < updRounds; r++) {
          if (!Array.isArray(listB) || listB.length === 0) break;
          const at = r % Math.min(listB.length, rows);
          listB[at].title = `upd ${r}`;
          listB[at].w = 60 + r % 4 * 20;
          abBoxW.value = 150 + 30 * r;
          const t0 = t();
          const rootInst = abRootInst;
          rootInst?.update?.();
          const patched = adapter.takePatches();
          const tPatch = t();
          let hostMs = -1;
          let applied = -1;
          let changedN = 0;
          let relayout = -1;
          let textLayers = 0;
          if (patched === null) {
            notes.push(`\u7B2C ${r} \u8F6E B \u8DEF takePatches() === null\uFF08\u7ED3\u6784\u6027\u53D8\u5316\uFF09\u2014\u2014\u5939\u5177\u7684\u6587\u672C/\u5BBD\u5EA6\u53D8\u66F4\u4E0D\u8BE5\u89E6\u53D1\u7ED3\u6784`);
          } else {
            const hu = t();
            const ho = JSON.parse(proteusHost.updatePatches(JSON.stringify(patched)));
            hostMs = t() - hu;
            if (ho.ok === true) {
              applied = ho.applied ?? -1;
              changedN = ho.changed_rects ?? 0;
              relayout = ho.relayout ?? -1;
              textLayers = ho.text_layers_applied ?? 0;
            } else {
              notes.push(`\u7B2C ${r} \u8F6E B \u8DEF updatePatches \u5931\u8D25\uFF1A${ho.error ?? ""}`);
            }
            if (ho.unsupported && ho.unsupported.length > 0) {
              notes.push(`B \u8F6E ${r}\uFF1A\u5185\u6838\u62D2\u6536 ${ho.unsupported.length} \u6761\uFF1A${JSON.stringify(ho.unsupported).slice(0, 200)}`);
            }
          }
          const geom = readRectsByOrder(semIdsB);
          geomsB.push(geom);
          const prevGeom = r === 0 ? rectsB : geomsB[r - 1];
          updB.push({
            round: r,
            patches: patched === null ? -1 : patched.length,
            applied,
            changed_rects: changedN,
            relayout,
            host_ms: hostMs,
            text_layers: textLayers,
            moved: maxGeomDelta(prevGeom, geom),
            driver_ms: tPatch - t0
          });
          rep.upd_b_text_applied += textLayers;
          const gA = geomsA[r];
          if (gA) {
            const { delta: dR, mismatches: mR, samples: sR } = geomDiff(gA, geom);
            rep.upd_geom_rounds.push({ round: r, delta: dR, mismatches: mR, samples: sR });
            if (!rep.upd_first_mismatch && mR > 0) {
              rep.upd_first_mismatch = { round: r, delta: dR };
            }
          }
        }
        rep.upd_rounds = updB.length;
        rep.upd_b = updB;
        let umax = 0;
        let umism = 0;
        let usamples = 0;
        for (const g of rep.upd_geom_rounds) {
          if (g.delta > umax) umax = g.delta;
          umism += g.mismatches;
          usamples += g.samples;
        }
        rep.upd_samples = usamples;
        rep.upd_max_delta = Math.round(umax * 1e3) / 1e3;
        rep.upd_mismatches = umism;
      }
      rep.upd_a = updA;
      const btnBCands = req.nodes.filter(
        (x) => x.backgroundColor === "#2f6fed"
      );
      if (btnBCands.length === 1 && typeof proteusHost.tapAt === "function") {
        const btnBId = Number(btnBCands[0].id);
        const bv = {
          node: btnBId,
          hit: -1,
          chain: [],
          fired: [],
          fired_width_deltas: [],
          errors: [],
          before: null,
          after: null,
          width_delta: 0,
          patches: -1,
          applied: -1,
          changed_rects: 0,
          text_layers: 0,
          driver_ms: 0
        };
        globalThis[GESTURE_CB] = (type, nodeId, chainJson) => {
          const chain = parseChain(chainJson, nodeId);
          bv.chain = chain;
          const r = adapter.dispatchEvent(nodeId, chain, type, 0, 0);
          bv.fired = r.fired;
          bv.errors = r.errors;
          return JSON.stringify({ ok: r.errors.length === 0 && r.fired.length > 0, fired: r.fired, chain, errors: r.errors });
        };
        bv.before = readRectOf(btnBId);
        const rectsAllBeforeB = readRectsAll();
        const tTap = t();
        if (bv.before) {
          const c = { x: bv.before.x + bv.before.width / 2, y: bv.before.y + bv.before.height / 2 };
          const tp = JSON.parse(proteusHost.tapAt(JSON.stringify(c)));
          if (tp.gestures_fired === 1) {
            bv.hit = tp.last?.target ?? -1;
          } else {
            notes.push(`\u2605B \u8DEF tap \u672A\u89E6\u53D1\u624B\u52BF\uFF08gestures_fired=${tp.gestures_fired ?? "\u7F3A\u5931"}\uFF09\u2014\u2014hit \u8BFB\u6570\u4E0D\u53EF\u4FE1`);
          }
        }
        const rootInstB = abRootInst;
        rootInstB?.update?.();
        const t0 = t();
        const patched = adapter.takePatches();
        bv.driver_ms = t() - t0;
        if (patched === null) {
          notes.push("\u2605B \u8DEF tap \u540E takePatches() === null\uFF08\u7ED3\u6784\u6027\u53D8\u5316\uFF09\u2014\u2014\u5939\u5177\u7684 boxW \u53D8\u66F4\u4E0D\u8BE5\u89E6\u53D1\u7ED3\u6784");
        } else {
          bv.patches = patched.length;
          const ho = JSON.parse(proteusHost.updatePatches(JSON.stringify(patched)));
          if (ho.ok === true) {
            bv.applied = ho.applied ?? -1;
            bv.changed_rects = ho.changed_rects ?? 0;
            bv.text_layers = ho.text_layers_applied ?? 0;
          } else {
            notes.push(`\u2605B \u8DEF tap \u540E updatePatches \u5931\u8D25\uFF1A${ho.error ?? ""}`);
          }
        }
        bv.after = readRectOf(btnBId);
        if (bv.before && bv.after) bv.width_delta = Math.round((bv.after.width - bv.before.width) * 1e3) / 1e3;
        const rectsAllAfterB = readRectsAll();
        bv.fired_width_deltas = bv.fired.map((id) => {
          const b = rectsAllBeforeB[String(id)];
          const a2 = rectsAllAfterB[String(id)];
          return b && a2 ? Math.round((a2.width - b.width) * 1e3) / 1e3 : -999;
        });
        rep.ev_b = bv;
        if (bv.hit !== btnBId) {
          notes.push(`\u2605B \u8DEF tap \u547D\u4E2D ${bv.hit} \u2260 \u6309\u94AE\u8282\u70B9 ${btnBId}\uFF08hitTest \u4E0E\u9002\u914D\u5668\u767B\u8BB0\u4E0D\u4E00\u81F4\uFF09`);
        }
      } else {
        notes.push(`\u2605B \u8DEF\u6309\u94AE\u5B9A\u4F4D\u5931\u8D25\uFF08#2f6fed \u547D\u4E2D ${btnBCands.length} \u4E2A\uFF0C\u5E94\u6070 1 \u4E2A\uFF09\u2014\u2014\u4E8B\u4EF6\u7B49\u4EF7\u5224\u636E\u5C06\u7F3A\u8BFB\u6570`);
      }
      rep.ev_before_delta = rectDelta(rep.ev_a?.before ?? null, rep.ev_b?.before ?? null);
      rep.ev_after_delta = rectDelta(rep.ev_a?.after ?? null, rep.ev_b?.after ?? null);
      const bubblesOk = (e) => !!e && e.chain.length >= 2 && e.fired.length >= 2 && e.chain[0] === e.hit;
      const deltasMatch = (() => {
        const a = rep.ev_a?.fired_width_deltas ?? [];
        const b = rep.ev_b?.fired_width_deltas ?? [];
        if (a.length !== b.length || a.length < 2) return false;
        return a.every((v, i) => Math.abs(v - b[i]) <= 0.01 && v > 0 && b[i] > 0);
      })();
      rep.ev_match = !!(rep.ev_a && rep.ev_b && rep.ev_before_delta >= 0 && rep.ev_before_delta <= 0.01 && rep.ev_after_delta >= 0 && rep.ev_after_delta <= 0.01 && Math.abs(rep.ev_a.width_delta - rep.ev_b.width_delta) <= 0.01 && bubblesOk(rep.ev_a) && bubblesOk(rep.ev_b) && deltasMatch);
      if (rep.ev_a && rep.ev_b) {
        notes.push(`\u4E8B\u4EF6\u8DEF\u5F84\uFF1AA \u547D\u4E2D ${rep.ev_a.hit} \xB7 \u94FE [${rep.ev_a.chain.join(">")}] \u6D3E\u53D1 [${rep.ev_a.fired.join(">")}] \xB7 \u5BBD ${rep.ev_a.before?.width}\u2192${rep.ev_a.after?.width}\uFF08\u6307\u4EE4 ${rep.ev_a.ops_bytes}B / applied ${rep.ev_a.applied}\uFF09\uFF1BB \u547D\u4E2D ${rep.ev_b.hit} \xB7 \u94FE [${rep.ev_b.chain.join(">")}] \u6D3E\u53D1 [${rep.ev_b.fired.join(">")}] \xB7 \u5BBD ${rep.ev_b.before?.width}\u2192${rep.ev_b.after?.width}\uFF08\u8865\u4E01 ${rep.ev_b.patches} / applied ${rep.ev_b.applied}\uFF09 \xB7 \u9010\u8DF3\u4F4D\u79FB A=${JSON.stringify(rep.ev_a.fired_width_deltas)} vs B=${JSON.stringify(rep.ev_b.fired_width_deltas)}`);
      }
      rep.ok = true;
      notes.push(`A \u8DEF ${rep.cost_a.total_ms.toFixed(1)}ms\uFF08\u5B9E\u4F8B\u5316 ${rep.cost_a.instantiate_ms} + \u5BBF\u4E3B ${rep.cost_a.host_ms}\uFF09`);
      notes.push(`B \u8DEF ${rep.cost_b.total_ms.toFixed(1)}ms\uFF08Vue mount ${rep.cost_b.vue_ms} + \u8BF7\u6C42 ${rep.cost_b.request_ms} + \u5E8F\u5217\u5316 ${rep.cost_b.serialize_ms} + \u5BBF\u4E3B ${rep.cost_b.host_ms}\uFF09`);
      return JSON.stringify(rep);
    } catch (e) {
      rep.error = e?.message ?? String(e);
      return JSON.stringify(rep);
    }
  }
  var abData = makeData(8);
  function readRectsByOrder(ids) {
    const out = [];
    try {
      const all = JSON.parse(proteusHost.readRects());
      const m = all.rects ?? {};
      for (const id of ids) {
        const r = m[String(id)];
        if (r) out.push({ id, x: r.x, y: r.y, width: r.width, height: r.height });
      }
    } catch {
    }
    return out;
  }
  function maxGeomDelta(a, b) {
    let m = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = b[i];
      const d = Math.max(Math.abs(x.x - y.x), Math.abs(x.y - y.y), Math.abs(x.width - y.width), Math.abs(x.height - y.height));
      if (d > m) m = d;
    }
    return Math.round(m * 1e3) / 1e3;
  }
  function geomDiff(a, b) {
    const n = Math.min(a.length, b.length);
    let delta = 0;
    let mismatches = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = b[i];
      const d = Math.max(Math.abs(x.x - y.x), Math.abs(x.y - y.y), Math.abs(x.width - y.width), Math.abs(x.height - y.height));
      if (d > delta) delta = d;
      if (d > 0.01) mismatches++;
    }
    return { delta: Math.round(delta * 1e3) / 1e3, mismatches, samples: n };
  }
  function parseChain(chainJson, nodeId) {
    if (typeof chainJson === "string" && chainJson.length > 0) {
      try {
        const arr = JSON.parse(chainJson);
        if (Array.isArray(arr) && arr.length > 0) {
          const ids = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x));
          if (ids.length > 0) return ids;
        }
      } catch {
      }
    }
    return nodeId >= 0 ? [nodeId] : [];
  }
  function drainTransitions(tpl, vapor, notes) {
    const changes = vapor.takeVisibilityChanges();
    if (changes.length === 0) return 0;
    const anims = [];
    for (const ch of changes) {
      const node = tpl.nodes.find((n) => n.id === ch.nodeId);
      const tr = node?.transition;
      if (!tr) continue;
      const channels = ch.visible ? tr.enter : tr.leave;
      for (const c of channels) {
        anims.push({ nodeId: ch.nodeId, kind: c.kind, from: c.from, to: c.to, durMs: tr.durMs, curve: tr.curve });
      }
    }
    if (anims.length === 0) return 0;
    if (typeof proteusHost.animStart !== "function") {
      notes.push(`<Transition> \u6709 ${anims.length} \u6761\u52A8\u753B\u5F85\u64AD\uFF0C\u4F46\u5BBF\u4E3B\u672A\u5B9E\u73B0 animStart\uFF08\u8FC7\u6E21\u4E0D\u4F1A\u53D1\u751F\uFF09`);
      return 0;
    }
    try {
      const out = JSON.parse(proteusHost.animStart(JSON.stringify({ anims })));
      if (out.ok !== true) {
        notes.push(`animStart \u5931\u8D25\uFF1A${out.error ?? "\u672A\u77E5"}`);
        return 0;
      }
      return out.started ?? anims.length;
    } catch (e) {
      notes.push(`animStart \u629B\u9519\uFF1A${String(e?.message ?? e)}`);
      return 0;
    }
  }
  function dispatchChainA(chain, type, index, state, run) {
    return dispatchGesture(chain, type, index, state, run);
  }
  var CHANNEL_KEYS = ["radius", "grad", "glow", "clip", "stroke_len", "mask"];
  function probeChannelsRaw(ids) {
    try {
      const r = JSON.parse(proteusHost.probeChannels(JSON.stringify(ids)));
      return (r.channels ?? []).filter((c) => c && c.id !== void 0);
    } catch {
      return [];
    }
  }
  function channelSig(probes) {
    const per = {};
    for (const k of CHANNEL_KEYS) per[k] = {};
    const bump = (k, v) => {
      const key = typeof v === "number" ? String(Math.round(v * 1e3) / 1e3) : String(v);
      const m = per[k];
      m[key] = (m[key] ?? 0) + 1;
    };
    let total = 0;
    for (const c of probes) {
      for (const k of CHANNEL_KEYS) {
        const v = c[k];
        if (v === void 0 || v === null) continue;
        if (typeof v === "number" && v === 0) continue;
        if (typeof v === "string" && v === "") continue;
        bump(k, v);
        total++;
      }
    }
    const sorted = {};
    for (const k of CHANNEL_KEYS) {
      const keys = Object.keys(per[k]).sort();
      const m = {};
      for (const kk of keys) m[kk] = per[k][kk];
      sorted[k] = m;
    }
    return { per_channel: sorted, total };
  }
  function runVirtualList(args) {
    const t = () => Date.now();
    const rows = Math.max(2, args.rows ?? 1e3);
    const notes = [];
    const rep = {
      ok: false,
      tpl_nodes: 0,
      sub_l1: 0,
      inst_nodes: 0,
      inst_rows: 0,
      inst_allocated_ids: 0,
      mount_ms: 0,
      row_count: 0,
      row_pitch: 0,
      rows_live_first: 0,
      cmds_live_first: 0,
      down_frames: 0,
      down_built_delta: 0,
      up_frames: 0,
      up_built_delta: 0,
      trail: [],
      moved_diff_pct: -1,
      back_top_diff_pct: -1,
      final_scroll: 0,
      row_frames_total: 0,
      built_total: 0,
      released_total: 0,
      uninstantiated_slots: 0,
      notes
    };
    try {
      const artifacts = JSON.parse(args.artifacts);
      rep.tpl_nodes = artifacts.tpl.nodes.length;
      rep.sub_l1 = artifacts.table.stats.l1;
      if (!artifacts.tpl.ok) {
        rep.error = "\u6A21\u677F\u4E0D\u53EF\u7528\uFF08\u6784\u5EFA\u671F\u8BCA\u65AD\uFF09";
        return JSON.stringify(rep);
      }
      const data = makeListData(rows);
      const read = (n) => data[n];
      const registry = new ListRegistry();
      const inst = instantiateTemplate(artifacts.tpl, { viewport: args.viewport, read, table: artifacts.table, registry });
      rep.inst_nodes = inst.nodes.length;
      rep.inst_rows = inst.virtual?.rows.length ?? 0;
      rep.inst_allocated_ids = inst.stats.allocatedIds;
      if (!inst.virtual || inst.virtual.rows.length === 0) {
        rep.error = "\u5B9E\u4F8B\u5316\u6CA1\u6709\u4EA7\u51FA virtual.rows\uFF08\u865A\u62DF\u5316\u4E0D\u53EF\u7528\uFF09";
        return JSON.stringify(rep);
      }
      const t2 = t();
      const mo = JSON.parse(
        proteusHost.mountVirtual(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes, rows: inst.virtual.rows }))
      );
      rep.mount_ms = t() - t2;
      if (mo.ok !== true) {
        rep.error = "mountVirtual \u5931\u8D25\uFF1A" + (mo.error ?? "");
        return JSON.stringify(rep);
      }
      rep.row_count = mo.row_count ?? -1;
      rep.row_pitch = mo.row_pitch ?? -1;
      rep.rows_live_first = mo.rows_live ?? -1;
      rep.cmds_live_first = mo.cmds_live ?? -1;
      const probe = () => {
        const o = JSON.parse(proteusHost.scrollRows('{"dy":0}'));
        return { live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1, released: o.released_total ?? -1 };
      };
      const p0 = probe();
      let builtPrev = p0.built;
      const step = (dir, frames, label) => {
        let builtDelta = 0;
        let lastDiff = -1;
        for (let i = 0; i < frames; i++) {
          const cap = i % 10 === 9;
          const o = JSON.parse(proteusHost.scrollRows(JSON.stringify({ dy: dir * 100, capture: cap })));
          if (o.ok !== true) {
            notes.push(`${label} \u7B2C ${i} \u5E27\u5931\u8D25\uFF1A${o.error ?? ""}`);
            break;
          }
          rep.final_scroll = o.scroll_y ?? 0;
          rep.row_frames_total = o.row_frames_total ?? 0;
          rep.built_total = o.built_total ?? 0;
          rep.released_total = o.released_total ?? 0;
          if (o.sig_diff_pct !== void 0) lastDiff = o.sig_diff_pct;
          if (i % 10 === 0 || i === frames - 1) {
            rep.trail.push({ f: i, scroll: o.scroll_y ?? 0, live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1 });
          }
        }
        builtDelta = (rep.built_total || 0) - builtPrev;
        builtPrev = rep.built_total || 0;
        return { builtDelta, lastDiff };
      };
      const down = step(1, 30, "\u4E0B\u6EDA");
      rep.down_frames = 30;
      rep.down_built_delta = down.builtDelta;
      rep.moved_diff_pct = down.lastDiff;
      const up = step(-1, 30, "\u4E0A\u6EDA");
      rep.up_frames = 30;
      rep.up_built_delta = up.builtDelta;
      const top = JSON.parse(proteusHost.scrollRows('{"dy":0,"capture":true}'));
      rep.back_top_diff_pct = top.sig_diff_pct ?? -1;
      rep.final_scroll = top.scroll_y ?? rep.final_scroll;
      rep.uninstantiated_slots = 0;
      rep.ok = rep.down_frames > 0 && rep.up_frames > 0;
      notes.push(`\u6574\u6811 ${rep.inst_nodes} \u8282\u70B9 / ${rep.row_count} \u884C \xB7 \u9996\u5E27\u7269\u5316 ${rep.rows_live_first} \u884C / ${rep.cmds_live_first} \u6307\u4EE4`);
      return JSON.stringify(rep);
    } catch (e) {
      rep.error = e?.message ?? String(e);
      return JSON.stringify(rep);
    }
  }
  function makeListData(rows) {
    return { list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 120, title: `row ${i + 1}` })) };
  }
  function runShort(args) {
    const t = () => Date.now();
    const rows = Math.max(1, args.rows ?? 8);
    const notes = [];
    const rep = {
      ok: false,
      tpl_nodes: 0,
      tpl_ok: false,
      sub_l1: 0,
      sub_l0: 0,
      sub_l1_rate: 0,
      sub_sources: [],
      inst_ms: 0,
      inst_nodes: 0,
      inst_reused_ids: 0,
      inst_allocated_ids: 0,
      inst_rows: 0,
      inst_values_filled: 0,
      inst_virtual_rows: 0,
      inst_text_filled: 0,
      inst_width_filled: 0,
      mix_text_probe: [],
      text_probe_rounds: [],
      gate_rounds: [],
      gate_text_nodes: [],
      once_node_id: -1,
      memo_node_id: -1,
      expr_probe: [],
      transition_started: 0,
      tpl_transition: [],
      component_mounts: 0,
      component_nodes: 0,
      component_kid_probe: {},
      slot_probe: { texts: [], rects: [], fills: [], markers_left: -1 },
      emit_probe: { emits: [], parent_source_after: void 0, geom_before: -1, geom_after: -1 },
      scoped_probe: { texts: [], anchor_id: -1, anchor_width_field: -1, anchor_width_rect: -1, destr_text: "", destr_width_field: -1, destr_width_rect: -1 },
      lifecycle_probe: { bindings: [], ran_handler: "", changed_sources: [], ops_bytes: 0, applied: 0, anchor_id: -1, geom_before: -1, geom_after: -1 },
      dyn_probe: { texts: [], mounts: [], geom: [], dropped: -1, notes: [] },
      directive_probe: { nodes: [], rounds: [], plays: [] },
      mixed_probe: { texts: [], leaves: 0, geom: [] },
      styleobj_probe: { anchor_id: -1, width_before: -1, width_after: -1, kernel_applied: 0, patch_calls: [] },
      mount_ms: 0,
      mount_nodes: 0,
      updates_run: 0,
      ops_bytes: 0,
      ops_ms: 0,
      apply_ms: 0,
      text_synced_total: 0,
      update_evidence: [],
      geom_probe: [],
      channels: [],
      ev_bindings: 0,
      ev_handlers: 0,
      ev_modifiers: 0,
      taps: 0,
      tap_evidence: [],
      uninstantiated_slots: 0,
      notes
    };
    try {
      const artifacts = JSON.parse(args.artifacts);
      const tpl = artifacts.tpl;
      const table = artifacts.table;
      rep.tpl_nodes = tpl.nodes.length;
      rep.tpl_transition = tpl.nodes.filter((n) => n.transition).map((n) => `${n.id}:${n.transition?.preset ?? ""}`);
      rep.tpl_ok = tpl.ok;
      rep.sub_l1 = table.stats.l1;
      rep.sub_l0 = table.stats.l0;
      rep.sub_l1_rate = table.stats.l1Rate;
      rep.sub_sources = table.sources.map((s2) => s2.sourceName);
      if (!tpl.ok) {
        rep.error = "\u6A21\u677F\u4E0D\u53EF\u7528\uFF08\u6784\u5EFA\u671F\u8BCA\u65AD\u2014\u2014\u89C1 gen-vapor-fixture.mjs \u8F93\u51FA\uFF09";
        return JSON.stringify(rep);
      }
      const embedded = artifacts.data;
      const data = embedded ? JSON.parse(JSON.stringify(embedded)) : makeData(rows);
      const read = (n) => data[n];
      const registry = new ListRegistry();
      const t2 = t();
      const componentDefs = {};
      for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
        componentDefs[nm] = { template: def.tpl, table: def.table, data: def.data };
      }
      const inst = instantiateTemplate(tpl, {
        viewport: args.viewport,
        read,
        table,
        registry,
        // ★P1-3：有注册表 ⇒ 组件内部被**展开**（无 ⇒ 保留边界标记、内部留空 + note）
        ...Object.keys(componentDefs).length > 0 ? { components: componentDefs } : {}
      });
      rep.inst_ms = t() - t2;
      rep.inst_nodes = inst.nodes.length;
      rep.inst_reused_ids = inst.stats.reusedTemplateIds;
      rep.inst_allocated_ids = inst.stats.allocatedIds;
      rep.inst_rows = inst.stats.rows;
      rep.inst_values_filled = inst.stats.valuesFilled;
      rep.inst_virtual_rows = inst.virtual?.rows.length ?? 0;
      rep.inst_text_filled = inst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).length;
      rep.inst_width_filled = inst.nodes.filter((n) => typeof n.width === "number").length;
      const segNodes = tpl.nodes.filter((n) => n.textSegments?.length);
      const segNodeIds = new Set(segNodes.map((n) => n.id));
      const staticsOf = new Map(segNodes.map((n) => [
        n.id,
        (n.textSegments ?? []).filter((sg) => sg.text !== void 0 && sg.text !== "").map((sg) => String(sg.text))
      ]));
      rep.mix_text_probe = inst.nodes.filter((n) => segNodeIds.has(n.id)).map((n) => ({ id: n.id, text: String(n.text ?? ""), statics: staticsOf.get(n.id) ?? [] }));
      const EXPR_PREFIXES = ["vt-", "pi-", "mx-", "jn-", "oc-"];
      rep.expr_probe = inst.nodes.map((n) => ({ id: n.id, text: String(n.text ?? "") })).filter((n) => EXPR_PREFIXES.some((p2) => n.text.startsWith(p2))).map((n) => ({ id: n.id, prefix: n.text.slice(0, 3), text: n.text }));
      if (rep.inst_text_filled === 0) notes.push("\u26A0 \u5B9E\u4F8B\u6811\u91CC\u6CA1\u6709\u4EFB\u4F55\u975E\u7A7A\u6587\u672C\u2014\u2014\u56DE\u586B\u94FE\u53EF\u7591");
      const t3 = t();
      const mountOut = proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
      rep.mount_ms = t() - t3;
      const mo = JSON.parse(mountOut);
      if (mo.ok !== true) {
        rep.error = "\u5BBF\u4E3B mount \u5931\u8D25\uFF1A" + (mo.error ?? mountOut.slice(0, 200));
        return JSON.stringify(rep);
      }
      rep.mount_nodes = mo.nodes ?? -1;
      rep.host_layout_ms = mo.layout_ms;
      rep.host_cmds = mo.cmds;
      const keys = new PropKeyTable();
      const strings = new StringPool();
      const captured = [];
      const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes));
      const evals = VaporRuntime.buildEvaluators(table.evaluators);
      const propCallLog = [];
      let childEmitCount = 0;
      const childRuntimes = [];
      const mountsByBoundary = /* @__PURE__ */ new Map();
      if (inst.componentMounts) {
        for (const mount of inst.componentMounts) {
          const childRt = new SlotRuntime(keys, strings, (bytes) => {
            captured.push(bytes);
            childEmitCount++;
          });
          const childVapor = mount.table ? new VaporRuntime(
            mount.table,
            childRt,
            VaporRuntime.buildEvaluators(mount.table.evaluators),
            mount.registry,
            void 0,
            mount.idOffset ?? 0
          ) : void 0;
          if (childVapor && mount.table) {
            const triggers2 = /* @__PURE__ */ new Map();
            childVapor.load(mount.ctx, (n, cb) => triggers2.set(n, cb));
            childVapor.relink(mount.ctx);
            childRt.flush();
          }
          const childDef = artifacts.components?.[mount.name];
          const entry2 = {
            mount,
            vapor: childVapor,
            runtime: childRt,
            childEvents: childDef?.events ?? [],
            childHandlers: childDef?.handlers ?? {}
          };
          mountsByBoundary.set(mount.boundaryNodeId, entry2);
          childRuntimes.push(entry2);
        }
      }
      rep.component_mounts = childRuntimes.length;
      rep.component_nodes = inst.stats.componentNodes;
      const onComponentProp = (boundaryLocalId, propName, value) => {
        const target = mountsByBoundary.get(boundaryLocalId);
        if (!target) {
          notes.push(`\u7EC4\u4EF6 props \u53D8\u5316\u627E\u4E0D\u5230\u6302\u8F7D\u8BB0\u5F55\uFF08boundary=${boundaryLocalId} ${propName}\uFF09\u2014\u2014\u5185\u90E8\u6E32\u67D3\u672A\u88C5\u914D\uFF1F`);
          return;
        }
        target.mount.props[propName] = value;
        propCallLog.push(`${propName}=${String(value)}`);
        if (!target.vapor) {
          propCallLog.push("(no-vapor)");
          return;
        }
        target.vapor.writeSlotsOfSource(propName, target.mount.ctx);
        target.runtime.flush();
      };
      const pendingPaint = /* @__PURE__ */ new Map();
      const paintLog = [];
      const onPaintProp = (nodeId, propKey, value) => {
        const field = propKey.slice("paint.".length);
        const rec = pendingPaint.get(nodeId) ?? {};
        rec[field] = value;
        pendingPaint.set(nodeId, rec);
        paintLog.push(`${nodeId}:${field}=${String(value)}`);
      };
      const flushPaint = () => {
        if (pendingPaint.size === 0) return 0;
        const patches = [...pendingPaint.entries()].map(([id, style]) => ({ id, style }));
        pendingPaint.clear();
        if (typeof proteusHost.updatePatches !== "function") {
          notes.push(`\u7ED8\u5236\u952E\u6709 ${patches.length} \u6761\u5F85\u66F4\u65B0\uFF0C\u4F46\u5BBF\u4E3B\u672A\u5B9E\u73B0 updatePatches\uFF08\u7ED8\u5236\u4E0D\u4F1A\u53D8\uFF09`);
          return 0;
        }
        try {
          const out = JSON.parse(proteusHost.updatePatches(JSON.stringify(patches)));
          if (out.ok !== true) {
            notes.push(`\u7ED8\u5236\u952E updatePatches \u5931\u8D25\uFF1A${out.error ?? "\u672A\u77E5"}`);
            return 0;
          }
          return patches.length;
        } catch (e) {
          notes.push(`\u7ED8\u5236\u952E updatePatches \u629B\u9519\uFF1A${String(e?.message ?? e)}`);
          return 0;
        }
      };
      const vapor = new VaporRuntime(table, slotRt, evals, registry, onComponentProp, 0, void 0, onPaintProp);
      const ctx = { read };
      const triggers = /* @__PURE__ */ new Map();
      vapor.load(ctx, (name, cb) => triggers.set(name, cb));
      vapor.relink(ctx);
      slotRt.flush();
      captured.length = 0;
      rep.uninstantiated_slots = vapor.uninstantiatedSlots.length;
      const handlers = artifacts.handlers ?? {};
      const events = artifacts.events ?? [];
      rep.ev_bindings = events.length;
      rep.ev_handlers = Object.keys(handlers).length;
      const emitIndex = /* @__PURE__ */ new Map();
      for (const e of events) {
        if (e.componentEmit) emitIndex.set(`${e.nodeId}:${e.event}`, e.handler);
      }
      const mergedEvents = events.filter((e) => !e.componentEmit);
      for (let i = 0; i < childRuntimes.length; i++) {
        const cr = childRuntimes[i];
        for (const e of cr.childEvents) {
          mergedEvents.push({ ...e, nodeId: e.nodeId + (cr.mount.idOffset ?? 0), handler: `@child:${i}:${e.handler}` });
        }
      }
      const byNodeEvent = indexEventBindings(mergedEvents);
      const dispatchState = createDispatchState();
      rep.ev_modifiers = events.filter((e) => e.stop || e.self || e.once).length;
      const runHandler = (name, _nodeId, payload) => {
        const acts = handlers[name];
        if (!acts) return false;
        for (const a of acts) {
          if (a.op === "emit") continue;
          const ctx2 = { read: (n) => n === "$event" ? payload : data[n] };
          const v = evalExpr(a.program, ctx2);
          const cur = data[a.source];
          if (a.op === "set") {
            data[a.source] = v;
          } else {
            const base = typeof cur === "number" && Number.isFinite(cur) ? cur : 0;
            const delta = typeof v === "number" && Number.isFinite(v) ? v : 0;
            data[a.source] = base + delta;
          }
        }
        return true;
      };
      const emitLog = [];
      const runChildHandler = (idx, name) => {
        const cr = childRuntimes[idx];
        if (!cr) return false;
        const acts = cr.childHandlers[name];
        if (!acts) return false;
        for (const a of acts) {
          if (a.op === "emit") {
            const evName = String(a.event ?? "");
            const payload = a.program ? evalExpr(a.program, cr.mount.ctx) : void 0;
            const boundaryHostId = cr.mount.boundaryNodeId + (cr.mount.treeOffset ?? 0);
            const parentHandler = emitIndex.get(`${boundaryHostId}:${evName}`);
            if (!parentHandler) {
              emitLog.push({ event: evName, payload, routed: false });
              notes.push(`\u5B50\u7EC4\u4EF6 ${cr.mount.name} \u7684 $emit('${evName}') \u6CA1\u6709\u7236\u7EA7\u76D1\u542C\uFF08\u8FB9\u754C ${boundaryHostId}\uFF09\u2014\u2014\u672A\u8DEF\u7531`);
              continue;
            }
            runHandler(parentHandler, void 0, payload);
            emitLog.push({ event: evName, payload, routed: true, handler: parentHandler });
            continue;
          }
          notes.push(`\u5B50\u7EC4\u4EF6 ${cr.mount.name} \u7684 handler \u52A8\u4F5C \`${String(a.op)}\`\uFF08\u6539 ${String(a.source)}\uFF09\u4E0D\u751F\u6548\u2014\u2014\u5B50\u7EC4\u4EF6\u65E0\u53EF\u53D8\u72B6\u6001\uFF08\u6784\u5EFA\u671F\u5FEB\u7167\uFF09`);
        }
        return true;
      };
      const gestureHits = [];
      globalThis.__proteusVaporGesture = (type, nodeId, chainJson) => {
        const chain = parseChain(chainJson, nodeId);
        const before2 = { ...data };
        const hit = dispatchChainA(chain, type, byNodeEvent, dispatchState, (h, id) => {
          const m = /^@child:(\d+):(.+)$/.exec(h);
          if (m) return runChildHandler(Number(m[1]), m[2]);
          return runHandler(h, id);
        });
        const handler = hit.handler;
        if (!handler) return JSON.stringify({ ok: false, reason: `\u94FE ${chain.join(">")} \u4E0A\u6CA1\u6709 ${type} \u7684 handler` });
        const ran = true;
        const fire = triggers.get("list");
        if (fire) fire();
        vapor.relink(ctx);
        slotRt.flush();
        const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
        const changedSources = {};
        for (const k of Object.keys(data)) {
          if (before2[k] !== data[k]) changedSources[k] = data[k];
        }
        let applied = -1;
        let relayout = -1;
        let changedN = 0;
        if (payload.length > 0) {
          try {
            const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload))));
            applied = ao.ok ? ao.applied ?? -1 : -2;
            relayout = ao.relayout_count ?? -1;
            changedN = ao.rects ? Object.keys(ao.rects).length : 0;
          } catch {
            applied = -3;
          }
        }
        gestureHits.push({
          tap: gestureHits.length + 1,
          hit: nodeId,
          chain,
          fired: hit.fired,
          handler,
          source_after: changedSources,
          // ★P2-3：终止/跳过读数（判据核「修饰符真的生效」——既有形态下恒 false/[]）
          stopped: hit.stopped,
          skipped_self: hit.skippedSelf
        });
        return JSON.stringify({
          ok: ran,
          handler,
          fired: hit.fired,
          changed: changedSources,
          ops: payload.length,
          applied,
          relayout,
          changed_rects: changedN
        });
      };
      if (typeof proteusHost.onGesture === "function") {
        proteusHost.onGesture("__proteusVaporGesture");
      }
      const itemSlots = table.sources.flatMap((s2) => s2.slots).filter((x) => x.kind === "list-item");
      const widthSlot = itemSlots.find((x) => x.propKey === "layout.width");
      const probeId = widthSlot ? registry.resolveNode(widthSlot.listId, "2", widthSlot.itemSlotId) : void 0;
      const rectsOf = () => {
        try {
          const ro = JSON.parse(proteusHost.readRects());
          return ro.rects ?? {};
        } catch {
          return {};
        }
      };
      const before = probeId !== void 0 ? rectsOf()[String(probeId)]?.width ?? -1 : -1;
      const updates = Math.max(0, args.updates ?? 3);
      const evidence = [];
      for (let r = 0; r < updates; r++) {
        const list = data.list;
        if (list.length < 2) break;
        const at = r % Math.min(list.length, rows);
        list[at].title = `upd ${r}`;
        list[at].w = 60 + r % 4 * 20;
        const to = t();
        const fire = triggers.get("list");
        if (!fire) {
          notes.push(`\u7B2C ${r} \u8F6E\uFF1A\u8BA2\u9605\u8868\u91CC\u6CA1\u6709 'list' \u6E90\uFF08\u7F16\u8BD1\u5668\u672A\u4EA7\u51FA\u8BE5\u6E90\uFF1F\uFF09`);
          break;
        }
        fire();
        slotRt.flush();
        rep.ops_ms += t() - to;
        const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
        rep.ops_bytes += payload.length;
        if (!payload.length) {
          notes.push(`\u7B2C ${r} \u8F6E\uFF1A\u8BA2\u9605\u8868\u672A\u4EA7\u51FA\u6307\u4EE4\uFF08\u69FD\u4F4D\u672A\u547D\u4E2D\uFF1F\uFF09`);
          continue;
        }
        const ta = t();
        const applyOut = proteusHost.applyOps(JSON.stringify(Array.from(payload)));
        rep.apply_ms += t() - ta;
        const ao = JSON.parse(applyOut);
        if (ao.ok !== true) {
          notes.push(`\u7B2C ${r} \u8F6E applyOps \u5931\u8D25\uFF1A${ao.error ?? ""}`);
          continue;
        }
        const changed = ao.rects ? Object.keys(ao.rects).length : 0;
        const probe = ao.text_probe;
        if (probe?.text) rep.text_probe_rounds.push(String(probe.text));
        evidence.push({
          round: r,
          row: at + 1,
          ops: payload.length,
          changed_rects: changed,
          relayout: ao.relayout ?? -1,
          // ★文本同步（本批修的"读了没入表"缺陷的**回归锁**）：内核回 text_updates，
          //   宿主必须消费并把新文本落到绘制真源（否则文字改了屏幕还是旧字）
          text_synced: ao.text_synced ?? -1
        });
        rep.text_synced_total += ao.text_synced ?? 0;
        rep.updates_run++;
      }
      rep.update_evidence = evidence;
      const tapButtons = events.filter((e) => e.event === "tap");
      if (typeof proteusHost.tapAt === "function" && tapButtons.length > 0) {
        for (const btn of tapButtons) {
          const rAll = JSON.parse(proteusHost.readRects());
          const r = rAll.rects?.[String(btn.nodeId)];
          if (!r) continue;
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          const before2 = { ...data };
          const geomBefore = r.height;
          let rectsBeforeTap = {};
          try {
            const rb = JSON.parse(proteusHost.readRects());
            rectsBeforeTap = rb.rects ?? {};
          } catch {
          }
          const tapOut = JSON.parse(proteusHost.tapAt(JSON.stringify({ x: cx, y: cy })));
          const tapFired = tapOut.gestures_fired === 1;
          if (!tapFired) {
            notes.push(`tap@${btn.nodeId} \u672A\u89E6\u53D1\u624B\u52BF\uFF08gestures_fired=${tapOut.gestures_fired ?? "\u7F3A\u5931"}\uFF09\u2014\u2014\u8BFB\u6570\u4E0D\u53EF\u4FE1`);
          }
          rep.taps++;
          const changedSources = {};
          for (const k of Object.keys(data)) if (before2[k] !== data[k]) changedSources[k] = data[k];
          let geomChanged = 0;
          let geomAfter = 0;
          let geomDiffIds = [];
          try {
            const afterAll = JSON.parse(proteusHost.readRects());
            const after = afterAll.rects ?? {};
            geomAfter = Object.keys(after).length;
            const before3 = rectsBeforeTap;
            geomDiffIds = Object.keys(after).filter((k) => {
              const a = after[k];
              const b = before3[k];
              if (!b || !a) return true;
              return a.width !== b.width || a.height !== b.height || a.x !== b.x || a.y !== b.y;
            }).map((k) => Number(k));
            const selfBefore = before3[String(btn.nodeId)]?.width;
            const selfAfter = after[String(btn.nodeId)]?.width;
            if (selfBefore !== void 0 || selfAfter !== void 0) {
              notes.push(`tap@${btn.nodeId} \u81EA\u8EAB\u5BBD\u5EA6 ${selfBefore} \u2192 ${selfAfter}` + (geomDiffIds.length === 0 ? "\uFF08\u51E0\u4F55\u65E0\u5DEE\u5F02\u2014\u2014\u53EF\u7591\uFF09" : ""));
            }
            geomChanged = geomDiffIds.length;
          } catch {
          }
          const lastHit = gestureHits.length > 0 ? gestureHits[gestureHits.length - 1] : null;
          rep.tap_evidence.push({
            tap: rep.taps,
            hit: tapFired ? tapOut.last?.target ?? -1 : -1,
            // ★未触发手势 ⇒ 不认陈旧 last
            // ★冒泡链 + 逐跳派发（2026-10-02：判据据此核"链没断、祖先 handler 真的跑了"）
            chain: lastHit?.chain ?? [],
            fired: lastHit?.fired ?? [],
            handler: lastHit?.handler ?? "",
            source_after: lastHit?.source_after ?? null,
            // ★P2-3：该次 tap 是否被 .stop 终止（判据 ⑨ 用；无修饰符时恒 false）
            stopped: lastHit?.stopped ?? false,
            skipped_self: lastHit?.skipped_self ?? [],
            ops: tapOut.ok ? 1 : 0,
            changed_rects: geomChanged,
            geom_before: geomBefore,
            geom_after: geomAfter,
            geom_diff_ids: geomDiffIds
          });
          void changedSources;
        }
      }
      const gateRounds = [];
      const gateTextNodes = [];
      if (triggers.has("onceVal") || triggers.has("memoDep")) {
        const allSlotsFlat = table.sources.flatMap((s3) => s3.slots);
        rep.once_node_id = allSlotsFlat.find((x) => x.once)?.nodeId ?? -1;
        rep.memo_node_id = allSlotsFlat.find((x) => x.memoId !== void 0)?.nodeId ?? -1;
        const runGate = (name, mut, expectSkip) => {
          mut();
          for (const [, cb] of triggers) cb();
          vapor.relink(ctx);
          slotRt.flush();
          const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
          captured.length = 0;
          const texts = [];
          const entries = [];
          if (payload.length > 0) {
            const d = decodeOps(payload);
            for (const op of d.ops) {
              if (op.op === 3 /* SET_TEXT */) {
                const t4 = String(d.strings.valueOf(op.textRef));
                texts.push(t4);
                entries.push({ nodeId: op.nodeId, text: t4 });
              }
            }
            try {
              proteusHost.applyOps(JSON.stringify(Array.from(payload)));
            } catch {
            }
          }
          gateRounds.push({ name, ops: payload.length, texts, expect_skip: expectSkip });
          gateTextNodes.push({ name, entries });
        };
        runGate("once-frozen", () => {
          data.onceVal = 42;
        }, true);
        runGate("plain-updated", () => {
          data.tapCount = 7;
          data.list[0].title = "gate";
        }, false);
        runGate("memo-clean", () => {
          data.memoVal = 99;
        }, true);
        runGate("memo-dirty", () => {
          data.memoDep = 1;
        }, false);
        rep.gate_rounds = gateRounds;
        rep.gate_text_nodes = gateTextNodes;
      }
      if (triggers.has("kidLabelW") && childRuntimes.length > 0) {
        const kidNodeIds = new Set(childRuntimes.flatMap((cr) => cr.mount.nodeIds));
        const kidText = inst.nodes.find((n) => kidNodeIds.has(n.id) && n.tag === "p-text");
        const kidTextNodeId = kidText?.id;
        rep.component_kid_probe = {
          text: kidText ? String(kidText.text ?? "") : void 0,
          width: kidText ? kidText.width ?? void 0 : void 0
        };
        const kidRectBefore = kidTextNodeId !== void 0 ? rectsOf()[String(kidTextNodeId)]?.width : void 0;
        propCallLog.length = 0;
        data.kidLabelW = 99;
        data.kidLabel = "k9";
        for (const [, cb] of triggers) cb();
        vapor.relink(ctx);
        slotRt.flush();
        for (const cr of childRuntimes) cr.runtime.flush();
        const kidPayloads = captured.slice();
        captured.length = 0;
        for (const pl of kidPayloads) {
          if (pl.length === 0) continue;
          try {
            proteusHost.applyOps(JSON.stringify(Array.from(pl)));
          } catch {
          }
        }
        let afterW;
        for (const b of kidPayloads) {
          try {
            const d = decodeOps(b);
            for (const op of d.ops) {
              if (op.op === 2 /* SET_STYLE */) {
                const k = d.keys.keyOf(op.keyId);
                if (k === "layout.width" && kidTextNodeId !== void 0 && op.nodeId === kidTextNodeId) {
                  afterW = op.value;
                }
              }
            }
          } catch {
          }
        }
        rep.component_kid_probe = { ...rep.component_kid_probe, ...afterW !== void 0 ? { width_after: afterW } : {} };
        const kidRectAfter = kidTextNodeId !== void 0 ? rectsOf()[String(kidTextNodeId)]?.width : void 0;
        rep.component_kid_probe = {
          ...rep.component_kid_probe,
          rect_before: kidRectBefore,
          rect_after: kidRectAfter
        };
      }
      if (childRuntimes.length > 0 && typeof proteusHost.tapAt === "function") {
        const emitBtn = inst.nodes.find((n) => n.text === "emit-btn");
        const anchorSlot = table.sources.find((s) => s.sourceName === "bumpTotal")?.slots.find((sl) => sl.kind === "style" && sl.propKey === "layout.width");
        const anchorId = anchorSlot?.nodeId;
        if (emitBtn && anchorId !== void 0) {
          const rectsNow = rectsOf();
          const btnRect = rectsNow[String(emitBtn.id)];
          const geomBefore = rectsNow[String(anchorId)]?.width ?? -1;
          emitLog.length = 0;
          if (btnRect && typeof btnRect.x === "number" && typeof btnRect.y === "number") {
            const tapOut = JSON.parse(proteusHost.tapAt(JSON.stringify({
              x: btnRect.x + (btnRect.width ?? 0) / 2,
              y: btnRect.y + (btnRect.height ?? 0) / 2
            })));
            if (tapOut.gestures_fired !== 1) {
              notes.push(`emits \u63A2\u9488\uFF1Atap \u672A\u89E6\u53D1\u624B\u52BF\uFF08gestures_fired=${tapOut.gestures_fired ?? "\u7F3A\u5931"}\uFF09\u2014\u2014\u8BFB\u6570\u4E0D\u53EF\u4FE1`);
            }
          } else {
            notes.push(`emits \u63A2\u9488\uFF1Aemit \u6309\u94AE\uFF08\u8282\u70B9 ${emitBtn.id}\uFF09\u6CA1\u6709\u5185\u6838\u77E9\u5F62\u2014\u2014tap \u65E0\u6CD5\u6CE8\u5165`);
          }
          const rectsAfter = rectsOf();
          rep.emit_probe = {
            emits: emitLog.slice(),
            parent_source_after: data.bumpTotal,
            geom_before: geomBefore,
            geom_after: rectsAfter[String(anchorId)]?.width ?? -1
          };
        } else {
          notes.push("emits \u63A2\u9488\uFF1A\u5939\u5177\u7F3A emit \u6309\u94AE\u6216 bumpTotal \u951A\uFF08\u8282\u70B9\u672A\u627E\u5230\uFF09\u2014\u2014\u5224\u636E\u6309\u7F3A\u5931\u5904\u7406");
        }
      }
      {
        const lifecycle = artifacts.lifecycle ?? [];
        if (lifecycle.length > 0) {
          const lifeNode = lifecycle[0];
          const rectsBefore = rectsOf();
          const geomBefore = rectsBefore[String(lifeNode.nodeId)]?.width ?? -1;
          const beforeVals = { ...data };
          let ranHandler = "";
          if (runHandler(lifeNode.handler)) ranHandler = lifeNode.handler;
          vapor.relink(ctx);
          slotRt.flush();
          const lifePayloads = captured.slice();
          captured.length = 0;
          let appliedTotal = 0;
          for (const pl of lifePayloads) {
            if (pl.length === 0) continue;
            try {
              const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(pl))));
              appliedTotal += ao.applied ?? 0;
            } catch {
            }
          }
          const changedSources = {};
          for (const k of Object.keys(data)) if (beforeVals[k] !== data[k]) changedSources[k] = data[k];
          const rectsAfter = rectsOf();
          rep.lifecycle_probe = {
            bindings: lifecycle.map((b) => `${b.phase}@${b.nodeId}:${b.handler}`),
            ran_handler: ranHandler,
            changed_sources: Object.keys(changedSources),
            ops_bytes: lifePayloads.reduce((a, b) => a + b.length, 0),
            applied: appliedTotal,
            anchor_id: lifeNode.nodeId,
            geom_before: geomBefore,
            geom_after: rectsAfter[String(lifeNode.nodeId)]?.width ?? -1
          };
        } else {
          rep.lifecycle_probe = { bindings: [], ran_handler: "", changed_sources: [], ops_bytes: 0, applied: 0, anchor_id: -1, geom_before: -1, geom_after: -1 };
        }
      }
      if (triggers.has("trVisible")) {
        const beforeTr = rep.transition_started;
        data.trVisible = true;
        for (const [, cb] of triggers) cb();
        vapor.relink(ctx);
        slotRt.flush();
        const payloadTr = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
        captured.length = 0;
        if (payloadTr.length > 0) {
          try {
            proteusHost.applyOps(JSON.stringify(Array.from(payloadTr)));
          } catch {
          }
        }
        rep.transition_started = beforeTr + drainTransitions(tpl, vapor, notes);
      }
      if (probeId !== void 0) {
        const after = rectsOf()[String(probeId)]?.width ?? -1;
        rep.geom_probe.push({ id: probeId, before, after });
      }
      try {
        const ch = JSON.parse(proteusHost.probeChannels("[2,3,4,5,6]"));
        if (ch.ok && ch.channels) rep.channels = ch.channels;
      } catch {
      }
      {
        const slotArt = artifacts.slot;
        if (slotArt?.tpl?.ok) {
          const slotDefs = {};
          for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
            slotDefs[nm] = { template: def.tpl, table: def.table };
          }
          const slotRegistry = new ListRegistry();
          const slotInst = instantiateTemplate(slotArt.tpl, {
            viewport: args.viewport,
            read: () => void 0,
            table: slotArt.table,
            registry: slotRegistry,
            components: slotDefs
          });
          try {
            const smOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: slotInst.viewport, nodes: slotInst.nodes }))
            );
            if (smOut.ok === true) {
              const rectsAll = JSON.parse(proteusHost.readRects());
              const rects = rectsAll.rects ?? {};
              rep.slot_probe = {
                texts: slotInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => String(n.text)),
                rects: slotInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => ({ id: n.id, width: rects[String(n.id)]?.width ?? -1 })),
                fills: (slotInst.slotMounts ?? []).map((m) => ({ name: m.name, filled: m.filled, contentIds: m.contentIds })),
                markers_left: slotInst.nodes.filter((n) => n.slotFor || n.slotOutlet).length
              };
            } else {
              notes.push(`\u63D2\u69FD\u63A2\u9488 mount \u5931\u8D25\uFF1A${smOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`\u63D2\u69FD\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push("\u63D2\u69FD\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 slot \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u246E \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      {
        const scopedArt = artifacts.scoped;
        if (scopedArt?.tpl?.ok) {
          const scopedDefs = {};
          for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
            scopedDefs[nm] = { template: def.tpl, table: def.table };
          }
          const scopedInst = instantiateTemplate(scopedArt.tpl, {
            viewport: args.viewport,
            // ★夹具的 `scopedN`/`scopedM` 初值（与 SCOPED_SFC 的 script 一致）——出口 props 的源头
            read: (n) => n === "scopedN" ? 7 : n === "scopedM" ? 9 : void 0,
            table: scopedArt.table,
            registry: new ListRegistry(),
            components: scopedDefs
          });
          try {
            const scOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: scopedInst.viewport, nodes: scopedInst.nodes }))
            );
            if (scOut.ok === true) {
              const rectsAll = JSON.parse(proteusHost.readRects());
              const rects = rectsAll.rects ?? {};
              const anchor = scopedInst.nodes.find((n) => typeof n.text === "string" && n.text.startsWith("cnt-"));
              const destrAnchor = scopedInst.nodes.find((n) => typeof n.text === "string" && n.text.startsWith("dct-"));
              rep.scoped_probe = {
                texts: scopedInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => String(n.text)),
                anchor_id: anchor?.id ?? -1,
                // ★节点字段（作用域样式写进去的）与**内核真值**（必须一致——"字段写了"与"内核认了"是两件事）
                anchor_width_field: anchor ? anchor.width ?? -1 : -1,
                anchor_width_rect: anchor ? rects[String(anchor.id)]?.width ?? -1 : -1,
                // ★解构形态：文本（`dct-9`）+ 样式（`dw as number` ⇒ 90；TS 断言同时被覆盖）
                destr_text: destrAnchor ? String(destrAnchor.text ?? "") : "",
                destr_width_field: destrAnchor ? destrAnchor.width ?? -1 : -1,
                destr_width_rect: destrAnchor ? rects[String(destrAnchor.id)]?.width ?? -1 : -1
              };
            } else {
              notes.push(`\u4F5C\u7528\u57DF\u63D2\u69FD\u63A2\u9488 mount \u5931\u8D25\uFF1A${scOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`\u4F5C\u7528\u57DF\u63D2\u69FD\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push("\u4F5C\u7528\u57DF\u63D2\u69FD\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 scoped \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u2470 \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      {
        const dynArt = artifacts.dyn;
        if (dynArt?.tpl?.ok) {
          const dynDefs = {};
          for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
            dynDefs[nm] = { template: def.tpl, table: def.table };
          }
          const dynInst = instantiateTemplate(dynArt.tpl, {
            viewport: args.viewport,
            // ★夹具的 `dynWhich` 初值 'DynA'（与 DYN_SFC 的 script 一致）——动态解析的输入
            read: (n) => n === "dynWhich" ? "DynA" : void 0,
            table: dynArt.table,
            registry: new ListRegistry(),
            components: dynDefs
          });
          try {
            const dOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: dynInst.viewport, nodes: dynInst.nodes }))
            );
            if (dOut.ok === true) {
              const rectsAll = JSON.parse(proteusHost.readRects());
              const rects = rectsAll.rects ?? {};
              const texts = dynInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => String(n.text));
              rep.dyn_probe = {
                texts,
                // 解析出的组件边界节点（判据核"解析成了谁"——从挂载记录读，不猜 id 规律）
                mounts: (dynInst.componentMounts ?? []).map((m) => m.name),
                // 内容节点的**内核宽度**（> 0 = 内核真布局了该子树）
                geom: dynInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => ({ id: n.id, width: rects[String(n.id)]?.width ?? -1 })),
                dropped: dynInst.stats.droppedNodeIds?.length ?? 0,
                notes: (dynInst.notes ?? []).slice(0, 4)
              };
            } else {
              notes.push(`\u52A8\u6001\u7EC4\u4EF6\u63A2\u9488 mount \u5931\u8D25\uFF1A${dOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`\u52A8\u6001\u7EC4\u4EF6\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push("\u52A8\u6001\u7EC4\u4EF6\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 dyn \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u2472 \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      {
        const dirArt = artifacts.directive;
        if (dirArt?.tpl?.ok) {
          const dirInst = instantiateTemplate(dirArt.tpl, {
            viewport: args.viewport,
            read: () => void 0,
            table: dirArt.table,
            registry: new ListRegistry()
          });
          try {
            const dOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: dirInst.viewport, nodes: dirInst.nodes }))
            );
            if (dOut.ok === true) {
              const dirNodes = dirArt.tpl.nodes.filter((n) => n.directives?.length);
              const animCalls = [];
              const dirState = /* @__PURE__ */ new Map();
              const runDirectiveRound = (values) => {
                let startedTotal = 0;
                for (const n of dirNodes) {
                  const dirs = n.directives;
                  for (const d of dirs) {
                    const cur = d.valueSrc !== void 0 ? values[d.valueSrc] : true;
                    const key = `${n.id}:${d.name}`;
                    const st = dirState.get(key) ?? { prev: void 0, seen: false };
                    const should = directiveShouldPlay(st.prev, cur, st.seen);
                    dirState.set(key, { prev: cur, seen: true });
                    if (!should) {
                      animCalls.push({ nodeId: n.id, preset: d.preset ?? "", started: 0, fromValue: st.seen ? st.prev : void 0, toValue: cur });
                      continue;
                    }
                    const channels = d.channels ?? [];
                    const anims = channels.map((c) => ({
                      nodeId: n.id,
                      kind: c.kind,
                      from: c.from,
                      to: c.to,
                      durMs: d.durMs ?? 220,
                      curve: d.curve ?? 1
                    }));
                    let started = 0;
                    if (anims.length > 0 && typeof proteusHost.animStart === "function") {
                      try {
                        const out = JSON.parse(proteusHost.animStart(JSON.stringify({ anims })));
                        started = out.ok === true ? out.started ?? anims.length : 0;
                      } catch {
                        started = 0;
                      }
                    }
                    startedTotal += started;
                    animCalls.push({
                      nodeId: n.id,
                      preset: d.preset ?? "",
                      started,
                      fromValue: st.seen ? st.prev : void 0,
                      toValue: cur
                    });
                  }
                }
                return startedTotal;
              };
              const roundA = runDirectiveRound({ pulse: false, zoomTrigger: 0 });
              const roundB = runDirectiveRound({ pulse: false, zoomTrigger: 0 });
              const roundC = runDirectiveRound({ pulse: true, zoomTrigger: 0 });
              const roundD = runDirectiveRound({ pulse: true, zoomTrigger: 1 });
              const roundE = runDirectiveRound({ pulse: false, zoomTrigger: 1 });
              rep.directive_probe = {
                nodes: dirNodes.map((n) => ({
                  id: n.id,
                  dirs: n.directives.map((d) => `${d.name}:${d.preset}:${d.channels?.length ?? 0}`)
                })),
                rounds: [
                  { name: "a:\u9996\u8BC4falsy", started: roundA },
                  { name: "b:\u540C\u503C", started: roundB },
                  { name: "c:pulse\u53D8true", started: roundC },
                  { name: "d:zoom\u53D81", started: roundD },
                  { name: "e:pulse\u53D8false", started: roundE }
                ],
                plays: animCalls
              };
            } else {
              notes.push(`\u5BBF\u4E3B\u6307\u4EE4\u63A2\u9488 mount \u5931\u8D25\uFF1A${dOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`\u5BBF\u4E3B\u6307\u4EE4\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push("\u5BBF\u4E3B\u6307\u4EE4\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 directive \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u2473 \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      {
        const mixArt = artifacts.mixed;
        if (mixArt?.tpl?.ok) {
          const mixInst = instantiateTemplate(mixArt.tpl, {
            viewport: args.viewport,
            // ★夹具的 `mixN` 初值 4（与 MIXED_SFC 的 script 一致）——插值合成的输入
            read: (n) => n === "mixN" ? 4 : void 0,
            table: mixArt.table,
            registry: new ListRegistry()
          });
          try {
            const mOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: mixInst.viewport, nodes: mixInst.nodes }))
            );
            if (mOut.ok === true) {
              const rectsAll = JSON.parse(proteusHost.readRects());
              const rects = rectsAll.rects ?? {};
              const texts = mixInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => String(n.text));
              rep.mixed_probe = {
                texts,
                // 合成叶总数（静态 + 段表叶——判据核与编译期一致，防"少合成多合成"）
                leaves: mixInst.nodes.filter((n) => n.tag === "p-text" && (typeof n.text === "string" && n.text.length > 0 || n.textSegments?.length)).length,
                // 内核几何（合成叶有宽度 = 内核真布局了它们）
                geom: mixInst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).map((n) => ({ id: n.id, text: String(n.text), width: rects[String(n.id)]?.width ?? -1 }))
              };
            } else {
              notes.push(`\u6DF7\u6392\u63A2\u9488 mount \u5931\u8D25\uFF1A${mOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`\u6DF7\u6392\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push("\u6DF7\u6392\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 mixed \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u3251 \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      {
        const soArt = artifacts.styleObj;
        if (soArt?.tpl?.ok) {
          const soInst = instantiateTemplate(soArt.tpl, {
            viewport: args.viewport,
            read: (n) => n === "stW" ? 120 : n === "stBg" ? "#2f6fed" : void 0,
            table: soArt.table,
            registry: new ListRegistry()
          });
          try {
            const sOut = JSON.parse(
              proteusHost.mount(JSON.stringify({ viewport: soInst.viewport, nodes: soInst.nodes }))
            );
            if (sOut.ok === true) {
              const anchor = soInst.nodes.find((n) => n.backgroundColor === "#2f6fed");
              const anchorId = anchor?.id;
              const rectsBefore = rectsOf();
              const widthBefore = anchorId !== void 0 ? rectsBefore[String(anchorId)]?.width ?? -1 : -1;
              const soKeys = new PropKeyTable();
              const soStrings = new StringPool();
              const soCaptured = [];
              const soRt = new SlotRuntime(soKeys, soStrings, (b) => soCaptured.push(b));
              const pending = /* @__PURE__ */ new Map();
              const patchCalls = [];
              const soVapor = new VaporRuntime(
                soArt.table,
                soRt,
                VaporRuntime.buildEvaluators(soArt.table.evaluators),
                void 0,
                void 0,
                0,
                void 0,
                (nodeId, propKey, value) => {
                  const f = propKey.slice("paint.".length);
                  const rec = pending.get(nodeId) ?? {};
                  rec[f] = value;
                  pending.set(nodeId, rec);
                }
              );
              const soData = { stW: 120, stBg: "#2f6fed" };
              const soCtx = { read: (n) => soData[n] };
              const soTriggers = /* @__PURE__ */ new Map();
              soVapor.load(soCtx, (n2, cb) => soTriggers.set(n2, cb));
              soVapor.relink(soCtx);
              soRt.flush();
              soCaptured.length = 0;
              pending.clear();
              soData.stW = 260;
              soData.stBg = "#e2483d";
              soVapor.relink(soCtx);
              soRt.flush();
              let kernelApplied = 0;
              for (const pl of soCaptured) {
                if (pl.length === 0) continue;
                const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(pl))));
                kernelApplied += ao.applied ?? 0;
                if (ao.unsupported && ao.unsupported.length > 0) notes.push(`:style \u63A2\u9488\u5185\u6838\u62D2\u6536\uFF1A${JSON.stringify(ao.unsupported).slice(0, 160)}`);
              }
              if (pending.size > 0) {
                const patches = [...pending.entries()].map(([id, style]) => ({ id, style }));
                patchCalls.push(patches);
                pending.clear();
                try {
                  proteusHost.updatePatches(JSON.stringify(patches));
                } catch {
                }
              }
              const rectsAfter = rectsOf();
              const widthAfter = anchorId !== void 0 ? rectsAfter[String(anchorId)]?.width ?? -1 : -1;
              rep.styleobj_probe = {
                anchor_id: anchorId ?? -1,
                width_before: widthBefore,
                width_after: widthAfter,
                kernel_applied: kernelApplied,
                patch_calls: patchCalls.map((ps) => ps.map((p) => `${p.id}:${JSON.stringify(p.style)}`))
              };
            } else {
              notes.push(`:style \u5BF9\u8C61\u63A2\u9488 mount \u5931\u8D25\uFF1A${sOut.error ?? "\u672A\u77E5"}`);
            }
          } catch (e) {
            notes.push(`:style \u5BF9\u8C61\u63A2\u9488\u5F02\u5E38\uFF1A${String(e?.message ?? e)}`);
          }
          try {
            proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
          } catch {
          }
        } else {
          notes.push(":style \u5BF9\u8C61\u63A2\u9488\uFF1A\u4EA7\u7269\u65E0 styleObj \u6BB5\uFF08\u5939\u5177\u672A\u8986\u76D6 \u21D2 \u5224\u636E \u3252 \u6309\u7F3A\u5931\u5904\u7406\uFF09");
        }
      }
      rep.ok = rep.updates_run > 0;
      if (!rep.ok) notes.push("\u589E\u91CF\u94FE\u672A\u8DD1\u8D77\u6765\u2014\u2014\u89C1\u4E0A\u65B9 notes");
      else notes.push(`\u5B9E\u4F8B\u6811 ${inst.nodes.length} \u8282\u70B9 / \u884C ${inst.stats.rows} / \u865A\u62DF\u5316\u884C ${rep.inst_virtual_rows} / \u589E\u91CF ${rep.updates_run} \u8F6E`);
      return JSON.stringify(rep);
    } catch (e) {
      rep.error = e?.message ?? String(e);
      return JSON.stringify(rep);
    }
  }
  globalThis.__proteusVaporRun = __proteusVaporRun;
})();

const curry = exports.curry = function(fn, ...partialArgs){
  return (...args)=>fn(...partialArgs, ...args);
}

const map = exports.map = function(vals, fn, ...fns){
  return vals.map((val)=>fns.reduce((acc, x)=>x(acc), fn(val)));
}

const fromEntries = exports.fromEntries = function(x){
  return x.reduce((r, [k,v]) => Object.assign(r, {[k]: v}), {});
}

const mapValues = exports.mapValues = function(obj, ...fns){
  return fromEntries(
    map(Object.entries(obj), ...(fns.map((fn)=>(([k,v])=>[k, fn(v, k)]))))
    .filter(([k,v])=>(v !== undefined))
  );
}

const mapValuesAsync = exports.mapValuesAsync = async function(obj, ...fns){
  return fromEntries(
    (await Promise.all(
      (await Promise.all(
        Object.entries(
          mapValues(obj, ...(
            fns.map((fn)=>(async (...args)=>(
              await fn(...(await Promise.all(args)))
            )))
          ))
        )
      ))
      .map(async ([k,v])=>[k, await v])
    ))
    .filter(([k,v])=>(v !== undefined))
  );
}

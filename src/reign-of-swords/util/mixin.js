// Assemble a class from methods spread over several files by concern: each source (a class or a plain object)
// has its methods copied onto `target.prototype`, so they all run with `this` = the one instance. A name defined
// twice would silently shadow the other one — that is an error. `label` names the class in that error.
export function mixInto(target, mixins, label = "Game") {
  for (const [from, src] of Object.entries(mixins)) {
    const methods = typeof src === "function" ? src.prototype : src;
    for (const name of Object.getOwnPropertyNames(methods)) {
      if (name === "constructor") continue;
      if (Object.prototype.hasOwnProperty.call(target.prototype, name))
        throw new Error(`${label}.${name} is defined twice (again in ${from})`);
      Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(methods, name));
    }
  }
}

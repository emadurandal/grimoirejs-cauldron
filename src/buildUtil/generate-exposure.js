import {
  globAsync,
  readFileAsync,
  templateCompileAsync,
  writeFileAsync,
  existsAsync
} from "../async-helper";
import { argv } from "yargs";
import path from "path";
import chalk from "chalk";
import { jsSafeString, getSuffix } from "./common";

let indexGen;

function generateStructureRecursively(obj, sepDirs, basePath) {
  if (sepDirs.length < 2) {
    return;
  }
  if (sepDirs[0] === '') {
    obj[sepDirs[1]] = jsSafeString(basePath + sepDirs[1]);
    return;
  }
  basePath = basePath + sepDirs[0];
  if (sepDirs[0] !== '' && obj[sepDirs[0]] === void 0) {
    obj[sepDirs[0]] = {};
  }
  if (sepDirs.length > 2) {
    generateStructureRecursively(obj[sepDirs[0]], sepDirs.slice(1), basePath);
  } else if (sepDirs.length === 2) {
    obj[sepDirs[0]][sepDirs[1]] = jsSafeString(basePath + sepDirs[1]);
  }
}

function asJSIndex(jsonStr, sepDirs) {
  for (let pathKey in sepDirs) {
    const keyName = jsSafeString(sepDirs[pathKey].reduce((p, c) => p + c));
    const regex = new RegExp(`(: *)"${keyName}"`);
    jsonStr = jsonStr.replace(regex, "$1" + keyName);
  }
  return jsonStr;
}

async function generateConst() {
  try {
    const template = await templateCompileAsync(path.normalize(__dirname + "/../../src/buildUtil/metaInfo-template.template"));
    const cwd = process.cwd();
    const pkgJson = JSON.parse(await readFileAsync(path.join(cwd, "package.json")));

    let templateArgs = {
      version: pkgJson.version,
      name: pkgJson.name
    };
    let content = template(templateArgs);
    let dest_path = path.resolve(path.join(path.dirname(path.join(cwd, argv.dest)), "metaInfo.ts"));
    if (!await existsAsync(dest_path) || content !== await readFileAsync(dest_path)) {
      await writeFileAsync(dest_path, content);
    }
  } catch (e) {
    console.log(e);
  }
}

async function generateIndex() {
  try {
    indexGen = await templateCompileAsync(path.normalize(__dirname + "/../../src/buildUtil/index-template.template"));
    const cwd = process.cwd();
    const pkgJson = JSON.parse(await readFileAsync(path.join(cwd, "package.json")));
    const projectSuffix = argv.core ? "core" : getSuffix(pkgJson.name);
    const destFileLocation = path.resolve(path.join(cwd, argv.dest));
    const mainFileLocation = path.resolve(path.join(cwd, argv.main));
    const metaInfoLocation = path.resolve(path.join(path.dirname(path.join(cwd, argv.dest)), "metaInfo.ts"));
    const basePath = path.join(cwd, argv.src); // absolute path of source directory
    const detectedFiles = await globAsync(path.join(cwd, argv.src, argv.ts ? "**/*.ts" : "**/*.js")); // glob all javascript files
    if (argv.debug) {
      console.log(chalk.cyan(`CWD:${cwd} Project Suffix:${projectSuffix}\n destination:${destFileLocation}\n mainFile:${mainFileLocation}\n basePath:${basePath}\n\n DetectedFiles:\n${detectedFiles}`));
    }
    const pathMap = {};
    // listup files containing `export default`
    for (let i = 0; i < detectedFiles.length; i++) {
      const relative = path.relative(basePath, detectedFiles[i]);
      const absolute = path.resolve(detectedFiles[i]);
      if (destFileLocation === absolute || mainFileLocation === absolute || metaInfoLocation === absolute || /\.d\.ts$/.test(absolute)) {
        continue;
      }
      const content = await readFileAsync(detectedFiles[i]);
      pathMap[relative] = path.parse(relative);
    }
    if (argv.debug) {
      console.log(chalk.cyan(`Target files:\n`));
      for (let key in pathMap) {
        console.log(chalk.cyan(`${key} : "${pathMap[key]}"`));
      }
    }
    // separate relative path by '/' or '\'
    const separated = {};
    for (let keyPath in pathMap) {
      separated[keyPath] = pathMap[keyPath].dir.split(path.sep);
      separated[keyPath].push(pathMap[keyPath].name); // last element of separated[path] is file name without extension
    }
    // make structure of index
    const structureObject = {};
    for (let keyPath in separated) {
      generateStructureRecursively(structureObject, separated[keyPath], "");
    }
    const jsonCode = JSON.stringify(structureObject, null, "  ");
    const objectCode = asJSIndex(jsonCode, separated);
    const imports = [];
    for (let keyPath in separated) {
      imports.push({
        path: "./" + keyPath.replace(/\.js|\.ts/g, ""),
        key: jsSafeString(separated[keyPath].reduce((p, c) => p + c))
      });
    }
    let templateArgs = {
      exportObject: objectCode,
      importCore: argv.core ? "" : 'import gr from "grimoirejs";',
      registerNamespace: argv.core ? "" : "gr.notifyRegisteringPlugin(__META__.__NAMESPACE__);",
      imports: imports,
      mainPath: "./" + path.relative(basePath, mainFileLocation).replace(/\.ts|\.js/g, ""),
      registerCode: `(window as any)["GrimoireJS"].lib.${projectSuffix} = __EXPOSE__;`,
      version: pkgJson.version,
      name: pkgJson.name
    };
    let index_ts_content = indexGen(templateArgs);
    let dest_path = path.join(cwd, argv.dest);
    if (!await existsAsync(dest_path) || index_ts_content !== await readFileAsync(dest_path)) {
      await writeFileAsync(dest_path, index_ts_content);
    }
  } catch (e) {
    console.log(e);
  }
}

(async function () {
  await generateIndex();
  await generateConst();
})()

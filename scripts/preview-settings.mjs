// Isolated fixture preview: no DSH process, credentials, storage, or external API calls.
// Run after building lib/client.js: node scripts/preview-settings.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const files = new Map([
  ['/react.js', new URL('./umd/react.development.js', pathToFileURL(require.resolve('react/package.json')))],
  ['/react-dom.js', new URL('./umd/react-dom.development.js', pathToFileURL(require.resolve('react-dom/package.json')))],
  ['/client.js', new URL('../lib/client.js', import.meta.url)],
])

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MinerU settings — isolated fixture</title>
<style>
:root {
  color-scheme: light;
  --dsw-alias-label-primary:#1f2937; --dsw-alias-label-secondary:#4b5563;
  --dsw-alias-label-tertiary:#6b7280; --dsw-alias-label-dimmed:#c8ccd4;
  --dsw-alias-border-l2:#e0e4ec; --dsw-alias-border-l3:#e5e7eb;
  --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f7f8fa; --dsw-alias-bg-layer-3:#fff;
  --dsw-alias-brand-primary:#4f6ef7; --dsw-alias-button-primary-fill:#4f6ef7;
  --dsw-alias-button-primary-hover:#3c59d8; --dsw-alias-label-primary-foreground:#fff;
}
:root[data-theme=dark] {
  color-scheme:dark;
  --dsw-alias-label-primary:#e5e7eb; --dsw-alias-label-secondary:#c2c7d0;
  --dsw-alias-label-tertiary:#9ca3af; --dsw-alias-label-dimmed:#626b79;
  --dsw-alias-border-l2:#3a414c; --dsw-alias-border-l3:#3a414c;
  --dsw-alias-bg-layer-1:#252a32; --dsw-alias-bg-layer-2:#1c2027; --dsw-alias-bg-layer-3:#252a32;
}
*{box-sizing:border-box}body{margin:24px auto;padding:0 16px;max-width:620px;font:14px/1.5 system-ui,sans-serif;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
h1{font-size:18px;margin:0 0 8px}.hint{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 20px}
</style>
<h1>插件 / Plugins</h1><p class="hint">MinerU fork · 隔离预览，所有配置及凭据操作均为模拟</p>
<div id="root"></div><p id="status" role="status" class="hint"></p>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
const params = new URLSearchParams(location.search);
const lang = params.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.lang = lang;
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
let dict, registration;
let config = {
 schemaVersion:1,activeProvider:'mp_official',
 providers:[
  {id:'mp_self_hosted',type:'self-hosted-v2',baseURL:'http://localhost:18000',apiKeyEnv:'MINERU_API_KEY',modelMap:{pipeline:'pipeline',vlm:'vlm-engine'},allowInsecureHttp:true},
  {id:'mp_official',type:'official-v4',baseURL:'https://mineru.net/api/v4',apiKeyEnv:'MINERU_API_KEY',models:['pipeline','vlm']}
 ],
 defaults:{model:'pipeline',parseMethod:'auto',language:'ch',formula:true,table:true,artifacts:['markdown']},
 storage:{storageRoot:'fixture-cache/pdf-mineru',cacheEnabled:true,retainSources:false,stagingTtlMs:86400000},
 polling:{pollIntervalMs:2000,pollTimeoutMs:600000,requestTimeoutMs:60000,operationTimeoutMs:3600000},
 retry:{maxAttempts:3,baseDelayMs:500,maxDelayMs:10000},output:{maxInlineChars:200000},
 limits:{maxFilesPerRequest:1,maxFileBytes:209715200,maxApiResponseBytes:8388608,maxZipDownloadBytes:536870912,maxZipEntries:10000,maxZipEntryBytes:268435456,maxZipTotalBytes:2147483648,maxZipCompressionRatio:200}
};
const ok = value => ({ok:true,value});
const rpc = {call:async (_channel,endpoint,payload) => {
 if(endpoint==='mineru/config.get') return ok({config});
 if(endpoint==='mineru/config.set') { config=payload.config; document.getElementById('status').textContent='Saved in fixture memory only'; return ok({config}); }
 if(endpoint==='mineru/probe') return ok({available:true,provider:payload.provider.id,authentication:'fixture',protocol_version:'v4'});
 return {ok:false,error:{message:'This fixture does not implement '+endpoint}};
}};
const credentials = {
 describe:async refs => ok(Object.fromEntries(refs.map(ref=>[ref,{configured:true,writable:true,source:'fixture'}]))),
 set:async () => ok(undefined),unset:async () => ok(undefined)
};
window.__ModuleLoader__ = {load:({factory}) => {
 const jsx = (type,props,key) => React.createElement(type, key===undefined ? props : {...props,key});
 const jsxs = (type,{children,...props},key) => React.createElement(type, key===undefined ? props : {...props,key}, ...children);
 const modules = {'react':React,'react/jsx-runtime':{jsx,jsxs,Fragment:React.Fragment}};
 const plugin = factory(name => {if(!(name in modules)) throw Error('Unexpected module '+name);return modules[name]});
 const ctx = {
  inject:(_deps,callback)=>callback(ctx),
  effect:effect=>effect(),get:name=>name==='connection'?{rpc}:undefined,
  locale:{register:(_ns,dicts)=>{dict=dicts[lang];return ()=>{}},bind:()=>key=>dict[key]},
  remote:{credentials},
  slots:{spec:()=>({}),inject:(_name,factory)=>factory(),register:(options,component)=>{registration={options,component};return ()=>{}}}
 };
 plugin.apply(ctx);
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(registration.component,{...registration.options.inject(),t:key=>dict[key]}));
}};
</script><script src="/client.js"></script></html>`

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(html)
    } else if (files.has(pathname)) {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      response.end(await readFile(files.get(pathname)))
    } else { response.writeHead(404); response.end() }
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
server.listen(0, '127.0.0.1', () => console.log(`Fixture preview: http://127.0.0.1:${server.address().port} (Ctrl+C to stop)`))

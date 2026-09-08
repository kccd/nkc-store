require('colors');
const http = require('http');
const commander = require('commander');
const koa = require('koa');
const koaBody = require('koa-body');
const router = require('./routes');
const fs = require('fs');
const path = require('path');
const tempPath = path.resolve(__dirname, `./temp`);

try {
  fs.accessSync(tempPath);
} catch (err) {
  fs.mkdirSync(tempPath);
}
// todo: 修复路径 1
const { port: configPort, attachment } = require('./configs.json');

commander
  .option('--host <host>', '服务监听地址')
  .option('--port <port>', '服务端口号', Number)
  .parse(process.argv);

const host = commander.host;
const port = commander.port === undefined ? configPort : commander.port;

const body = require('./middlewares/body');
const error = require('./middlewares/error');
const init = require('./middlewares/init');

if (!attachment || attachment.length === 0) {
  throw new Error(`未指定文件目录`);
}

const app = new koa();

app.on('error', (err) => {
  // console.log(`koa error:`, err);
});

app.use(
  koaBody({
    multipart: true,
    formidable: {
      maxFields: 20,
      maxFileSize: 1024 * 1024 * 1024 * 1024 * 1024,
      uploadDir: tempPath,
      hash: 'md5',
      keepExtensions: true,
    },
  }),
);
app.use(error);
app.use(init);
app.use(router.routes());
app.use(body);

const server = http.createServer(app.callback());

const onListening = () => {
  console.log(`store service is running at ${host ? `${host}:` : ''}${port}`.green);
};

if (host) {
  server.listen(port, host, onListening);
} else {
  server.listen(port, onListening);
}

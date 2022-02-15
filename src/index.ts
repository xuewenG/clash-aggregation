import express from 'express'
import { serverConfig, mysqlConfig } from './config'
import { AppRouter, cors } from '@ixuewen/express-util'
import { initPool } from '@ixuewen/mysql-util'

import './controllers/subscribeController'

const app = express()

app.use(serverConfig.contextPath, AppRouter.getInstance())
cors(app, serverConfig.corsOrigin)
initPool(mysqlConfig)

const port = serverConfig.port

app.listen(port)
console.log(`Server running at: http://127.0.0.1:${port}`)

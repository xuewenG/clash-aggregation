import { Controller, All } from '@ixuewen/express-util'
import { queryList } from '@ixuewen/mysql-util'
import { Request, Response } from 'express'
import fetch from 'node-fetch'
import YAML from 'yaml'

enum ProxyType {
  VMESS = 'vmess',
  SS = 'ss'
}

interface Proxy {
  name: string
  type: ProxyType
}

enum ProxyGroupType {
  SELECT = 'select',
  URL_TEST = 'url-test'
}

interface ProxyGroup {
  name: string
  type: ProxyGroupType
  proxies: string[]
}

interface AutoSelectProxyGroup extends ProxyGroup {
  url: string
  interval: number
  tolerance: number
}

type Rules = string[]

interface ApiJson {
  proxies: Proxy[]
  rules: Rules
}

interface User {
  name: string
  token: string
}

interface Subscribe {
  name: string
  url: string
}

const getSubscribeList = async (): Promise<Subscribe[]> => {
  const subscribeList: Subscribe[] = await queryList(
    'select * from subscribe',
    {}
  )
  return subscribeList
}

const getUserList = async (): Promise<User[]> => {
  const userList: User[] = await queryList('select * from user', {})
  return userList
}

const getBaseConfig = () => {
  return {
    port: 10808,
    'socks-port': 10809,
    'mixed-port': 10802,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: true,
    'external-controller': '127.0.0.1:9090'
  }
}

const getApiJsonList = async (): Promise<ApiJson[]> => {
  const apiList = (await getSubscribeList()).map(subscribe => subscribe.url)
  const apiRequestList = apiList.map(api =>
    fetch(api, {
      headers: {
        'user-agent': 'ClashX/1.20.4.1'
      },
      method: 'GET'
    })
  )
  const apiContentList = (await Promise.all(apiRequestList)).map(request =>
    request.text()
  )
  const apiJsonList: ApiJson[] = (await Promise.all(apiContentList)).map(
    content => YAML.parse(content)
  )
  return apiJsonList
}

const getProxyList = (apiJsonList: ApiJson[]): Proxy[] => {
  return apiJsonList
    .map(apiJson => apiJson.proxies)
    .flat(1)
    .filter(proxy => proxy.type === ProxyType.VMESS)
}

const getProxyGroupList = (proxyList: Proxy[]): ProxyGroup[] => {
  const DIRECT_PROXY_NAME = 'DIRECT'
  const AUTO_SELECT_GROUP_NAME = '自动选择'

  const proxySelect: ProxyGroup = {
    name: '节点选择',
    type: ProxyGroupType.SELECT,
    proxies: [
      AUTO_SELECT_GROUP_NAME,
      DIRECT_PROXY_NAME,
      ...proxyList.map(proxy => proxy.name)
    ]
  }

  const autoSelect: AutoSelectProxyGroup = {
    name: AUTO_SELECT_GROUP_NAME,
    type: ProxyGroupType.URL_TEST,
    proxies: proxyList.map(proxy => proxy.name),
    url: 'https://www.gstatic.com/generate_204',
    interval: 30000,
    tolerance: 10000
  }

  return [proxySelect, autoSelect]
}

const getRuleList = (): Rules => {
  return [
    'DOMAIN-SUFFIX,ip6-localhost,DIRECT',
    'DOMAIN-SUFFIX,ip6-loopback,DIRECT',
    'DOMAIN-SUFFIX,local,DIRECT',
    'DOMAIN-SUFFIX,localhost,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,100.64.0.0/10,DIRECT,no-resolve',
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'IP-CIDR,198.18.0.0/16,DIRECT,no-resolve',
    'IP-CIDR6,::1/128,DIRECT,no-resolve',
    'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
    'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
    'IP-CIDR6,fd00::/8,DIRECT,no-resolve',
    'GEOIP,CN,DIRECT',
    'MATCH,节点选择'
  ]
}

@Controller('/subscribe')
export class SubscribeController {
  @All('/get')
  async getSubscribe(req: Request, resp: Response) {
    const token = req.query.token
    const userList = await getUserList()
    const currentUser = userList.find(user => user.token === token)
    if (!token || !currentUser) {
      resp.write(
        YAML.stringify({
          ...getBaseConfig(),
          proxies: [],
          'proxy-groups': [],
          rules: []
        })
      )
      resp.end()
      return
    }
    const apiJsonList = await getApiJsonList()
    const proxyList = getProxyList(apiJsonList)
    const proxyGroupList = getProxyGroupList(proxyList)
    const rules = getRuleList()
    const result = {
      ...getBaseConfig(),
      proxies: proxyList,
      'proxy-groups': proxyGroupList,
      rules
    }
    resp.write(YAML.stringify(result))
    resp.end()
  }
}

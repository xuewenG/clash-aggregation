import { Controller, All } from '@ixuewen/express-util'
import { queryList } from '@ixuewen/mysql-util'
import { Request, Response } from 'express'
import fetch from 'node-fetch'
import YAML from 'yaml'

type ProxyServerName = string

enum ProxyServerType {
  VMESS = 'vmess',
  SS = 'ss'
}

interface ProxyServer {
  name: ProxyServerName
  type: ProxyServerType
}

enum ProxyGroupName {
  CURRENT_GROUP = '当前策略',
  AUTO_SELECT = '自动选择',
  MANUALLY_SELECT = '手动选择'
}

enum ProxyGroupType {
  SELECT = 'select',
  URL_TEST = 'url-test'
}

interface ProxyGroup {
  name: ProxyGroupName
  type: ProxyGroupType
  proxies: ProxyPolicy[]
}

interface AutoSelectProxyGroup extends ProxyGroup {
  url: string
  interval: number
  tolerance: number
}

enum SpecialProxyPolicy {
  DIRECT = 'DIRECT',
  REJECT = 'REJECT'
}

type ProxyPolicy = ProxyServerName | ProxyGroupName | SpecialProxyPolicy

type Rules = string[]

interface ApiJson {
  proxies: ProxyServer[]
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
  const subscribeList: Subscribe[] = await queryList('select * from subscribe')
  return subscribeList
}

const getUserList = async (): Promise<User[]> => {
  const userList: User[] = await queryList('select * from user')
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

const getProxyList = (apiJsonList: ApiJson[]): ProxyServer[] => {
  return apiJsonList
    .map(apiJson => apiJson.proxies)
    .flat(1)
    .filter(proxy => proxy.type === ProxyServerType.VMESS)
}

const getProxyGroupList = (proxyList: ProxyServer[]): ProxyGroup[] => {
  const currentGroup: ProxyGroup = {
    name: ProxyGroupName.CURRENT_GROUP,
    type: ProxyGroupType.SELECT,
    proxies: [
      ProxyGroupName.AUTO_SELECT,
      ProxyGroupName.MANUALLY_SELECT,
      SpecialProxyPolicy.DIRECT
    ]
  }

  const autoSelect: AutoSelectProxyGroup = {
    name: ProxyGroupName.AUTO_SELECT,
    type: ProxyGroupType.URL_TEST,
    proxies: proxyList.map(proxy => proxy.name),
    url: 'https://www.gstatic.com/generate_204',
    interval: 30000,
    tolerance: 10000
  }

  const manuallySelect: ProxyGroup = {
    name: ProxyGroupName.MANUALLY_SELECT,
    type: ProxyGroupType.SELECT,
    proxies: proxyList.map(proxy => proxy.name)
  }

  return [currentGroup, autoSelect, manuallySelect]
}

const getRuleList = (): Rules => {
  return [
    `DOMAIN-SUFFIX,ip6-localhost,${SpecialProxyPolicy.DIRECT}`,
    `DOMAIN-SUFFIX,ip6-loopback,${SpecialProxyPolicy.DIRECT}`,
    `DOMAIN-SUFFIX,local,${SpecialProxyPolicy.DIRECT}`,
    `DOMAIN-SUFFIX,localhost,${SpecialProxyPolicy.DIRECT}`,
    `IP-CIDR,10.0.0.0/8,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR,100.64.0.0/10,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR,127.0.0.0/8,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR,172.16.0.0/12,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR,192.168.0.0/16,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR,198.18.0.0/16,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR6,::1/128,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR6,fc00::/7,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR6,fe80::/10,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `IP-CIDR6,fd00::/8,${SpecialProxyPolicy.DIRECT},no-resolve`,
    `GEOIP,CN,${SpecialProxyPolicy.DIRECT}`,
    `MATCH,${ProxyGroupName.CURRENT_GROUP}`
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

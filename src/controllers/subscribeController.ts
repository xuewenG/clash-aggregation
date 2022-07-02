import { Controller, All } from '@ixuewen/express-util'
import { queryList, queryOne } from '@ixuewen/mysql-util'
import { Request, Response } from 'express'
import fetch from 'node-fetch'
import YAML from 'yaml'

interface BaseConfig {
  port: number
  'socks-port': number
  'mixed-port': number
  'allow-lan': boolean
  mode: 'global' | 'rule'
  'log-level': 'debug' | 'info'
  ipv6: boolean
  'external-controller': string
}

type ProxyServerName = string

enum ProxyGroupName {
  CURRENT_GROUP = '当前策略',
  AUTO_SELECT = '自动选择',
  MANUALLY_SELECT = '手动选择'
}

enum SpecialProxyName {
  DIRECT = 'DIRECT',
  REJECT = 'REJECT'
}

enum ProxyServerType {
  VMESS = 'vmess',
  SS = 'ss'
}

enum ProxyGroupType {
  SELECT = 'select',
  URL_TEST = 'url-test'
}

type ProxyPolicy = ProxyServerName | ProxyGroupName | SpecialProxyName

interface ProxyServer {
  name: ProxyServerName
  type: ProxyServerType
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

type Rules = string[]

interface ApiJson {
  proxies: ProxyServer[]
  rules: Rules
}

interface User {
  id: number
  name: string
  token: string
}

interface Subscribe {
  id: number
  name: string
  url: string
}

const getSubscribeList = async (userId: number): Promise<Subscribe[]> => {
  try {
    return await queryList(
      `
        SELECT
          *
        FROM
          subscribe
        WHERE
          id IN ( SELECT subscribeId AS id FROM userSubscribe WHERE userId = ? );
      `,
      userId
    )
  } catch (err) {
    console.error(err)
  }
  return Promise.resolve([])
}

const getUserByToken = async (token: string): Promise<User | null> => {
  try {
    return await queryOne('SELECT * FROM user WHERE token = ?', token)
  } catch (err) {
    console.error(err)
  }
  return Promise.resolve(null)
}

const getBaseConfig = (): BaseConfig => {
  return {
    port: 10808,
    'socks-port': 10809,
    'mixed-port': 10802,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: true,
    'external-controller': '127.0.0.1:10805'
  }
}

type SubscribFetcher = (ignoreCache?: boolean) => Promise<string>

const subscribeFetcherFactory = (() => {
  const REFRESH_TIMEOUT = 1 * 60 * 60 * 1000
  const FETCHER_REMOVE_TIMEOUT = 7 * 24 * 60 * 60 * 1000

  const fetcherMap = new Map<string, SubscribFetcher>()
  return (subscribeUrl: string) => {
    let fetcher: SubscribFetcher | undefined = fetcherMap.get(subscribeUrl)
    if (!fetcher) {
      let textPromise: Promise<string> | null = null
      let refreshTimer: NodeJS.Timer | null = null
      fetcher = async (ignoreCache = false) => {
        let text = ''
        if (textPromise) {
          text = await textPromise
        }
        if (!text || !textPromise || ignoreCache) {
          textPromise = fetch(subscribeUrl, {
            headers: {
              'user-agent': 'ClashX/1.20.4.1'
            },
            method: 'GET'
          })
            .then(resp => resp.text())
            .catch(err => {
              console.error(err)
              return ''
            })
          if (!refreshTimer) {
            refreshTimer = setTimeout(() => {
              refreshTimer = null
              const fetcher = fetcherMap.get(subscribeUrl)
              if (fetcher) {
                fetcher(true)
              }
            }, REFRESH_TIMEOUT)
          }
        }
        return textPromise
      }
      fetcherMap.set(subscribeUrl, fetcher)
      setTimeout(() => {
        fetcherMap.delete(subscribeUrl)
        if (refreshTimer) {
          clearTimeout(refreshTimer)
        }
      }, FETCHER_REMOVE_TIMEOUT)
    }
    return fetcher
  }
})()

const getSubscribeContentList = async (userId: number): Promise<ApiJson[]> => {
  const subscribeUrlList = (await getSubscribeList(userId)).map(
    subscribe => subscribe.url
  )
  const textList = subscribeUrlList.map(subscribeUrl =>
    subscribeFetcherFactory(subscribeUrl)()
  )
  const jsonList: ApiJson[] = (await Promise.all(textList))
    .map(content => {
      let json: ApiJson = {
        proxies: [],
        rules: []
      }
      try {
        json = YAML.parse(content)
      } catch (err) {
        console.error(err)
      }
      if (!json.proxies) {
        json.proxies = []
      }
      if (!json.rules) {
        json.rules = []
      }
      return json
    })
    .filter(json => json)
  return jsonList
}

const getProxyServerList = (apiJsonList: ApiJson[]): ProxyServer[] => {
  return apiJsonList
    .map(apiJson => apiJson.proxies || [])
    .flat(1)
    .filter(proxy => proxy)
}

const getProxyGroupList = (proxyList: ProxyServer[]): ProxyGroup[] => {
  const currentGroup: ProxyGroup = {
    name: ProxyGroupName.CURRENT_GROUP,
    type: ProxyGroupType.SELECT,
    proxies: [
      ProxyGroupName.AUTO_SELECT,
      ProxyGroupName.MANUALLY_SELECT,
      SpecialProxyName.DIRECT
    ]
  }

  const autoSelect: AutoSelectProxyGroup = {
    name: ProxyGroupName.AUTO_SELECT,
    type: ProxyGroupType.URL_TEST,
    proxies: proxyList.map(proxy => proxy.name),
    interval: 1200,
    tolerance: 3,
    url: 'https://www.gstatic.com/generate_204'
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
    `DOMAIN-SUFFIX,local,${SpecialProxyName.DIRECT}`,
    `DOMAIN-SUFFIX,localhost,${SpecialProxyName.DIRECT}`,
    `DOMAIN-SUFFIX,ip6-localhost,${SpecialProxyName.DIRECT}`,
    `DOMAIN-SUFFIX,ip6-loopback,${SpecialProxyName.DIRECT}`,
    `IP-CIDR,10.0.0.0/8,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR,100.64.0.0/10,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR,127.0.0.0/8,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR,172.16.0.0/12,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR,192.168.0.0/16,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR,198.18.0.0/16,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR6,::1/128,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR6,fc00::/7,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR6,fe80::/10,${SpecialProxyName.DIRECT},no-resolve`,
    `IP-CIDR6,fd00::/8,${SpecialProxyName.DIRECT},no-resolve`,
    `GEOIP,CN,${SpecialProxyName.DIRECT}`,
    `MATCH,${ProxyGroupName.CURRENT_GROUP}`
  ]
}

type GetSubscribeResult = {
  proxies: ProxyServer[]
  'proxy-groups': ProxyGroup[]
  rules: string[]
} & BaseConfig

@Controller('/subscribe')
export class SubscribeController {
  @All('/get')
  async getSubscribe(req: Request, resp: Response) {
    resp.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const result: GetSubscribeResult = {
      ...getBaseConfig(),
      proxies: [],
      'proxy-groups': [],
      rules: []
    }

    const token = req.query.token
    if (!token || typeof token !== 'string') {
      resp.end(YAML.stringify(result), 'utf-8')
      return
    }

    const currentUser = await getUserByToken(token)
    if (!currentUser) {
      resp.end(YAML.stringify(result), 'utf-8')
      return
    }

    const apiJsonList = await getSubscribeContentList(currentUser.id)
    const proxyList = getProxyServerList(apiJsonList)
    const proxyGroupList = getProxyGroupList(proxyList)
    const rules = getRuleList()

    result.proxies = proxyList
    result['proxy-groups'] = proxyGroupList
    result.rules = rules

    resp.end(YAML.stringify(result), 'utf-8')
  }
}

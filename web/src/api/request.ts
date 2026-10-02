import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { message } from 'antd';
import { activeGraphId } from '@/graph/profile';
import i18n from '@/i18n';
import { localeFromPath } from '@/i18n/locale';

declare module 'axios' {
  // 响应拦截器把后端统一响应解包成 { success, data, message } 后才交给调用方
  export interface AxiosResponse {
    success: boolean;
    message?: string;
    code?: number;
    detail?: unknown;
  }
}

function apiErrorText(data?: { code?: string; message?: string; params?: Record<string, unknown> }, status?: number): string {
  const code = data?.code;
  if (code && i18n.exists(`error.${code}`)) return i18n.t(`error.${code}`, data?.params || {});
  if (data?.message) return data.message;
  if (status) return i18n.t('error.request_failed_status', { status });
  return i18n.t('error.request_failed');
}

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 180000,
  headers: { 'Content-Type': 'application/json' },
});

// 每个请求都带上当前图谱（/g/:graphId 路由激活的那个），后端按 graph 参数隔离数据
request.interceptors.request.use((config) => {
  const graph = activeGraphId();
  if (graph) config.params = { graph, ...(config.params || {}) };
  config.headers.set('Accept-Language', localeFromPath() === 'en' ? 'en' : 'zh-CN');
  return config;
});

request.interceptors.response.use(
  (response: AxiosResponse): any => {
    const { data } = response;
    if (data instanceof Blob) return data;
    if (data?.success === true) {
      return { success: true, data: data.data, message: data.message };
    }
    return Promise.reject(new Error(apiErrorText(data) || i18n.t('error.request_failed')));
  },
  async (error) => {
    if (error.response) {
      const { status } = error.response;
      let data = error.response.data;
      if (data instanceof Blob) {
        try {
          data = JSON.parse(await data.text());
          error.response.data = data;
        } catch {
          data = {};
        }
      }
      const text = apiErrorText(data, status);
      error.message = text;
      message.error(text);
    } else if (error.request) {
      message.error(i18n.t('error.network'));
    }
    return Promise.reject(error);
  },
);

export default request;

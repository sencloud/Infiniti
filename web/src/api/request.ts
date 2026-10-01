import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { message } from 'antd';
import { activeGraphId } from '@/graph/profile';

declare module 'axios' {
  // 响应拦截器把后端统一响应解包成 { success, data, message } 后才交给调用方
  export interface AxiosResponse {
    success: boolean;
    message?: string;
    code?: number;
    detail?: unknown;
  }
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
  return config;
});

request.interceptors.response.use(
  (response: AxiosResponse): any => {
    const { data } = response;
    if (data instanceof Blob) return data;
    if (data?.success === true) {
      return { success: true, data: data.data, message: data.message };
    }
    return Promise.reject(new Error(data?.message || '请求失败'));
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
      if (data?.message) error.message = data.message;
      message.error(data?.message || `请求失败 (${status})`);
    } else if (error.request) {
      message.error('网络错误，请确认 Infiniti 服务已启动');
    }
    return Promise.reject(error);
  },
);

export default request;

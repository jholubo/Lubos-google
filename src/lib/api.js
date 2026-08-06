import axios from 'axios';

const backendUrl = (typeof process !== 'undefined' && process.env?.REACT_APP_BACKEND_URL) || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
const api = axios.create({
  baseURL: `${backendUrl}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

export const formatUSD = (amount) => `$${Number(amount || 0).toFixed(2)}`;
export const formatVES = (amount, rate) => `Bs. ${(Number(amount || 0) * rate).toFixed(2)}`;

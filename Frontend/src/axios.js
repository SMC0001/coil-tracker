import axios from "axios";

// Backend API URL (adjust port if different)
const API = "http://localhost:4000/api";

// Create a pre-configured axios instance
const instance = axios.create({ baseURL: API });

// Automatically attach token to every request
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token"); // read token saved at login
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default instance;

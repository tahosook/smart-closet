import React, { useState, useEffect } from 'react';
import { CloudSun, Sun, CloudRain, Wind, MapPin, RefreshCw } from 'lucide-react';

interface WeatherData {
  city: string;
  tempCurrent: number;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  sleeveAdvice: string;
  recommendedCategory: 'short' | 'seven' | 'long';
}

interface WeatherWidgetProps {
  onWeatherLoaded?: (data: WeatherData) => void;
}

const ABIKO_COORDS = { lat: 35.8644, lon: 139.9708, name: '千葉県 我孫子市' };

export const WeatherWidget: React.FC<WeatherWidgetProps> = ({ onWeatherLoaded }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = async (lat: number, lon: number, cityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&current_weather=true&timezone=Asia%2FTokyo`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('天気データの取得に失敗しました');
      const data = await res.json();

      const tempCurrent = Math.round(data.current_weather?.temperature ?? 20);
      const tempMax = Math.round(data.daily?.temperature_2m_max?.[0] ?? 22);
      const tempMin = Math.round(data.daily?.temperature_2m_min?.[0] ?? 14);
      const weatherCode = data.current_weather?.weathercode ?? 0;

      let sleeveAdvice = '🌤️ 七分袖・長袖推奨';
      let recommendedCategory: 'short' | 'seven' | 'long' = 'long';

      if (tempMax >= 26) {
        sleeveAdvice = '☀️ 半袖・七分袖推奨';
        recommendedCategory = 'short';
      } else if (tempMax >= 20) {
        sleeveAdvice = '🌤️ 七分袖・長袖推奨';
        recommendedCategory = 'seven';
      } else {
        sleeveAdvice = '🧥 長袖推奨（羽織プラス）';
        recommendedCategory = 'long';
      }

      const weatherObj: WeatherData = {
        city: cityName,
        tempCurrent,
        tempMax,
        tempMin,
        weatherCode,
        sleeveAdvice,
        recommendedCategory,
      };

      setWeather(weatherObj);
      if (onWeatherLoaded) onWeatherLoaded(weatherObj);
    } catch (e: any) {
      console.error(e);
      setError('天気情報を取得できませんでした');
      // Fallback sensible default for Abiko
      const fallback: WeatherData = {
        city: cityName,
        tempCurrent: 19,
        tempMax: 22,
        tempMin: 14,
        weatherCode: 1,
        sleeveAdvice: '🌤️ 七分袖・長袖推奨',
        recommendedCategory: 'seven',
      };
      setWeather(fallback);
      if (onWeatherLoaded) onWeatherLoaded(fallback);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather(ABIKO_COORDS.lat, ABIKO_COORDS.lon, ABIKO_COORDS.name);
  }, []);

  const handleToggleLocation = () => {
    if (!useCurrentLocation) {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUseCurrentLocation(true);
            fetchWeather(pos.coords.latitude, pos.coords.longitude, '現在地');
          },
          () => {
            alert('現在地を取得できませんでした。我孫子市の天気を使用します。');
            setUseCurrentLocation(false);
            fetchWeather(ABIKO_COORDS.lat, ABIKO_COORDS.lon, ABIKO_COORDS.name);
          }
        );
      }
    } else {
      setUseCurrentLocation(false);
      fetchWeather(ABIKO_COORDS.lat, ABIKO_COORDS.lon, ABIKO_COORDS.name);
    }
  };

  const getWeatherIcon = (code: number) => {
    if (code === 0) return <Sun className="w-5 h-5 text-amber-400" />;
    if (code <= 3) return <CloudSun className="w-5 h-5 text-sky-400" />;
    if (code >= 51 && code <= 67) return <CloudRain className="w-5 h-5 text-blue-400" />;
    return <Wind className="w-5 h-5 text-slate-400" />;
  };

  return (
    <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-3 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
        <button
          onClick={handleToggleLocation}
          className="flex items-center gap-1 hover:text-white transition-colors"
        >
          <MapPin className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-medium text-slate-200">{weather?.city || '千葉県 我孫子市'}</span>
          <span className="text-[10px] text-slate-500">({useCurrentLocation ? '現在地' : '我孫子'})</span>
        </button>

        <button
          onClick={() =>
            useCurrentLocation
              ? handleToggleLocation()
              : fetchWeather(ABIKO_COORDS.lat, ABIKO_COORDS.lon, ABIKO_COORDS.name)
          }
          className="p-1 hover:text-white transition-colors"
          title="天気を再取得"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-blue-400' : ''}`} />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {weather && getWeatherIcon(weather.weatherCode)}
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-white tracking-tight">
              {weather ? `${weather.tempCurrent}℃` : '--℃'}
            </span>
            <span className="text-xs text-slate-400">
              最高 <strong className="text-rose-400">{weather ? `${weather.tempMax}℃` : '--'}</strong> /
              最低 <strong className="text-sky-400">{weather ? `${weather.tempMin}℃` : '--'}</strong>
            </span>
          </div>
        </div>

        {weather && (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-950/70 text-blue-300 border border-blue-800/60 shadow-sm animate-pulse">
            {weather.sleeveAdvice}
          </span>
        )}
      </div>
      {error && <div className="text-[10px] text-amber-400/80 mt-1">{error}</div>}
    </div>
  );
};

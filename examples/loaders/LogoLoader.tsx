import React from 'react';
import './LogoLoader.css';

interface LogoLoaderProps {
  size?: number;
  text?: string;
}

const LogoLoader: React.FC<LogoLoaderProps> = ({
  size = 120,
  text = '加载中...'
}) => {
  return (
    <div className="logo-loader-container">
      <div className="logo-loader-content">
        {/* 院徽SVG动画 */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 200 200"
          className="logo-loader-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* 外圆环1 */}
          <circle
            cx="100"
            cy="100"
            r="95"
            fill="none"
            stroke="#0066CC"
            strokeWidth="3"
            className="logo-path logo-path-1"
          />

          {/* 外圆环2 */}
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke="#0066CC"
            strokeWidth="2"
            className="logo-path logo-path-2"
          />

          {/* 内圆环 */}
          <circle
            cx="100"
            cy="100"
            r="68"
            fill="none"
            stroke="#0066CC"
            strokeWidth="12"
            className="logo-path logo-path-3"
          />

          {/* 中心D字母弧形 - 简化版 */}
          <path
            d="M 70 100 Q 70 70, 100 70 Q 130 70, 130 100 Q 130 130, 100 130 Q 70 130, 70 100"
            fill="none"
            stroke="#0066CC"
            strokeWidth="8"
            className="logo-path logo-path-4"
          />

          {/* D字母中间的装饰线 */}
          <path
            d="M 85 85 L 105 95 M 85 115 L 105 105"
            stroke="#00AAFF"
            strokeWidth="3"
            strokeLinecap="round"
            className="logo-path logo-path-5"
          />

          {/* 中心点 */}
          <circle
            cx="100"
            cy="100"
            r="4"
            fill="#0066CC"
            className="logo-center-dot"
          />
        </svg>

        {/* 加载文字 */}
        {text && (
          <div className="logo-loader-text">
            {text}
            <span className="logo-loader-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogoLoader;

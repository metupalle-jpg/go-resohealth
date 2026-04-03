"use client";
import React from 'react';
import { motion } from 'framer-motion';

const Hero: React.FC = () => {
  return (
    <motion.div 
      className="relative bg-gradient-to-r from-blue-500 to-purple-600 text-white py-20 px-4 sm:py-32 sm:px-6 lg:px-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <svg
          width="404"
          height="404"
          fill="none"
          viewBox="0 0 404 404"
          className="absolute top-10 left-1/2 transform -translate-x-1/2 text-blue-400 opacity-30"
        >
          <defs>
            <pattern
              id="85737c0e-0916-41d7-917f-596dc7edfa27"
              x="0"
              y="0"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <rect x="0" y="0" width="4" height="4" fill="currentColor" />
            </pattern>
          </defs>
          <rect
            width="404"
            height="404"
            fill="url(#85737c0e-0916-41d7-917f-596dc7edfa27)"
          />
        </svg>
      </div>
      <div className="relative max-w-7xl mx-auto text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
          Transforming Healthcare with <span className="text-blue-200">ResoHealth</span>
        </h1>
        <p className="mt-6 text-xl max-w-3xl mx-auto sm:text-2xl">
          Innovative solutions for a healthier tomorrow. Join us in revolutionizing the healthcare industry with cutting-edge technology.
        </p>
        <div className="mt-10 flex justify-center">
          <motion.a
            href="#"
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 sm:px-8 sm:py-4"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Get Started
          </motion.a>
          <motion.a
            href="#"
            className="ml-6 inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 bg-opacity-60 hover:bg-opacity-70 sm:px-8 sm:py-4"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Learn More
          </motion.a>
        </div>
      </div>
    </motion.div>
  );
};

export default Hero;
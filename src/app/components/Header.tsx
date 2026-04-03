"use client";
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <div className="text-2xl font-bold text-blue-600">ResoHealth</div>
        <nav className="hidden md:flex space-x-8">
          <a href="#" className="text-gray-600 hover:text-blue-600">Home</a>
          <a href="#" className="text-gray-600 hover:text-blue-600">Services</a>
          <a href="#" className="text-gray-600 hover:text-blue-600">About</a>
          <a href="#" className="text-gray-600 hover:text-blue-600">Contact</a>
        </nav>
        <div>
          <a href="#" className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md font-medium">Sign In</a>
        </div>
      </div>
    </header>
  );
};

export default Header;

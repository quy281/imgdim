# MKG Khảo Sát — SketchUp Extension Loader
# Xuất 1 hoặc hàng loạt Group/Component sang gói thư viện 2D SVG + 3D COLLADA
# tương thích trực tiếp với MKG Khảo Sát (https://do.mkg.vn/).

require 'sketchup.rb'
require 'extensions.rb'

module MKG
  module KhaoSatExporter
    PLUGIN_ID = 'mkg_khaosat_exporter'.freeze unless defined?(PLUGIN_ID)
    PLUGIN_NAME = 'MKG Khảo Sát — Xuất Thư Viện 2D & 3D'.freeze unless defined?(PLUGIN_NAME)
    remove_const(:PLUGIN_VERSION) if const_defined?(:PLUGIN_VERSION)
    PLUGIN_VERSION = '1.0.2'.freeze

    if !file_loaded?(__FILE__)
      loader = File.join(__dir__, PLUGIN_ID, 'main')
      ext = SketchupExtension.new(PLUGIN_NAME, loader)
      ext.description = 'Xuất nhanh 1 hoặc hàng loạt Group/Component từ SketchUp sang file .mkglib.json (đầy đủ 2D CAD SVG + mô hình 3D COLLADA + kích thước mm) để nạp vào Backend do.mkg.vn.'
      ext.version     = PLUGIN_VERSION
      ext.copyright   = '2026 MKG (do.mkg.vn)'
      ext.creator     = 'MKG Interior Tech'
      Sketchup.register_extension(ext, true)
      file_loaded(__FILE__)
    else
      # Hỗ trợ cài đè .rbz trong khi SketchUp đang mở mà không cần khởi động lại
      main_rb = File.join(__dir__, PLUGIN_ID, 'main.rb')
      load main_rb if File.exist?(main_rb)
    end
  end
end

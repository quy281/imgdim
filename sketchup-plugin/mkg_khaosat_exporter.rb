# MKG Khảo Sát — SketchUp Extension Loader
# Xuất 1 hoặc hàng loạt Group/Component sang gói thư viện 2D SVG + 3D COLLADA
# tương thích trực tiếp với MKG Khảo Sát (https://do.mkg.vn/).

require 'sketchup.rb'
require 'extensions.rb'

module MKG
  module KhaoSatExporter
    PLUGIN_ID = 'mkg_khaosat_exporter'.freeze
    PLUGIN_NAME = 'MKG Khảo Sát — Xuất Thư Viện 2D & 3D'.freeze
    PLUGIN_VERSION = '1.0.0'.freeze

    unless file_loaded?(__FILE__)
      loader = File.join(__dir__, PLUGIN_ID, 'main')
      ext = SketchupExtension.new(PLUGIN_NAME, loader)
      ext.description = 'Xuất nhanh 1 hoặc hàng loạt Group/Component từ SketchUp sang file .mkglib.json (đầy đủ 2D CAD SVG chiếu bằng + mô hình 3D COLLADA + kích thước mm) để nạp vào Backend do.mkg.vn.'
      ext.version     = PLUGIN_VERSION
      ext.copyright   = '2026 MKG (do.mkg.vn)'
      ext.creator     = 'MKG Interior Tech'
      Sketchup.register_extension(ext, true)
      file_loaded(__FILE__)
    end
  end
end

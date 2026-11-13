# encoding: UTF-8
# MKG Khảo Sát — SketchUp Extension Main Module
# Tương thích SketchUp 2017 -> 2026 (Windows & macOS, Ruby 2.2 -> Ruby 3.2+)

require 'sketchup.rb'
require 'json'
require 'base64'
require 'tmpdir'
require 'fileutils'
require 'time'

module MKG
  module KhaoSatExporter
    extend self

    GROUPS = [
      { 'key' => 'bedroom', 'name' => 'Phòng ngủ' },
      { 'key' => 'living',  'name' => 'Khách + ăn' },
      { 'key' => 'kitchen', 'name' => 'Bếp' },
      { 'key' => 'wc',      'name' => 'WC' },
      { 'key' => 'elec',    'name' => 'Điện & TB' },
      { 'key' => 'other',   'name' => 'Khác' }
    ].freeze

    def plugin_dir
      __dir__
    end

    def definition_of(entity)
      return nil unless entity
      if entity.respond_to?(:definition)
        entity.definition
      elsif entity.respond_to?(:entities) && entity.entities.respond_to?(:parent)
        entity.entities.parent
      end
    end

    def slugify(text)
      s = text.to_s.encode('UTF-8', invalid: :replace, undef: :replace, replace: '')
      map = {
        'à' => 'a', 'á' => 'a', 'ạ' => 'a', 'ả' => 'a', 'ã' => 'a',
        'â' => 'a', 'ầ' => 'a', 'ấ' => 'a', 'ậ' => 'a', 'ẩ' => 'a', 'ẫ' => 'a',
        'ă' => 'a', 'ằ' => 'a', 'ắ' => 'a', 'ặ' => 'a', 'ẳ' => 'a', 'ẵ' => 'a',
        'è' => 'e', 'é' => 'e', 'ẹ' => 'e', 'ẻ' => 'e', 'ẽ' => 'e',
        'ê' => 'e', 'ề' => 'e', 'ế' => 'e', 'ệ' => 'e', 'ể' => 'e', 'ễ' => 'e',
        'ì' => 'i', 'í' => 'i', 'ị' => 'i', 'ỉ' => 'i', 'ĩ' => 'i',
        'ò' => 'o', 'ó' => 'o', 'ọ' => 'o', 'ỏ' => 'o', 'õ' => 'o',
        'ô' => 'o', 'ồ' => 'o', 'ố' => 'o', 'ộ' => 'o', 'ổ' => 'o', 'ỗ' => 'o',
        'ơ' => 'o', 'ờ' => 'o', 'ớ' => 'o', 'ợ' => 'o', 'ở' => 'o', 'ỡ' => 'o',
        'ù' => 'u', 'ú' => 'u', 'ụ' => 'u', 'ủ' => 'u', 'ũ' => 'u',
        'ư' => 'u', 'ừ' => 'u', 'ứ' => 'u', 'ự' => 'u', 'ử' => 'u', 'ữ' => 'u',
        'ỳ' => 'y', 'ý' => 'y', 'ỵ' => 'y', 'ỷ' => 'y', 'ỹ' => 'y',
        'đ' => 'd',
        'À' => 'a', 'Á' => 'a', 'Ạ' => 'a', 'Ả' => 'a', 'Ã' => 'a',
        'Â' => 'a', 'Ầ' => 'a', 'Ấ' => 'a', 'Ậ' => 'a', 'Ẩ' => 'a', 'Ẫ' => 'a',
        'Ă' => 'a', 'Ằ' => 'a', 'Ắ' => 'a', 'Ặ' => 'a', 'Ẳ' => 'a', 'Ẵ' => 'a',
        'È' => 'e', 'É' => 'e', 'Ẹ' => 'e', 'Ẻ' => 'e', 'Ẽ' => 'e',
        'Ê' => 'e', 'Ề' => 'e', 'Ế' => 'e', 'Ệ' => 'e', 'Ể' => 'e', 'Ễ' => 'e',
        'Ì' => 'i', 'Í' => 'i', 'Ị' => 'i', 'Ỉ' => 'i', 'Ĩ' => 'i',
        'Ò' => 'o', 'Ó' => 'o', 'Ọ' => 'o', 'Ỏ' => 'o', 'Õ' => 'o',
        'Ô' => 'o', 'Ồ' => 'o', 'Ố' => 'o', 'Ộ' => 'o', 'Ổ' => 'o', 'Ỗ' => 'o',
        'Ơ' => 'o', 'Ờ' => 'o', 'Ớ' => 'o', 'Ợ' => 'o', 'Ở' => 'o', 'Ỡ' => 'o',
        'Ù' => 'u', 'Ú' => 'u', 'Ụ' => 'u', 'Ủ' => 'u', 'Ũ' => 'u',
        'Ư' => 'u', 'Ừ' => 'u', 'Ứ' => 'u', 'Ự' => 'u', 'Ử' => 'u', 'Ữ' => 'u',
        'Ỳ' => 'y', 'Ý' => 'y', 'Ỵ' => 'y', 'Ỷ' => 'y', 'Ỹ' => 'y',
        'Đ' => 'd'
      }
      s = s.gsub(/[#{map.keys.join}]/, map).downcase
      s = s.gsub(/[^a-z0-9]+/, '_').gsub(/\A_+|_+\z/, '')
      s.empty? ? 'mau_sketchup' : s
    end

    def fold_vn(text)
      slugify(text).tr('_', ' ')
    end

    def guess_metadata(name, min_z_mm, h_mm)
      f = fold_vn(name)
      group = 'other'
      sym = 'cab'
      mount = 'floor'
      back = true

      if f =~ /\b(giuong|bed|tap dau giuong|nightstand|ban trang diem|dresser|tu ao|wardrobe|tu quan ao|ban lam viec|desk)\b/
        group = 'bedroom'
      elsif f =~ /\b(sofa|ban tra|coffee|ke tv|tv stand|tivi|ban an|dining|armchair|ghe don|tham|rug|vach lam|cay xanh|plant)\b/
        group = 'living'
      elsif f =~ /\b(bep|kitchen|dao bep|island|tu lanh|fridge|chau rua|sink|hut mui|hood|lo nuong|oven)\b/
        group = 'kitchen'
      elsif f =~ /\b(bon cau|toilet|lavabo|basin|tam dung|shower|bon tam|bathtub|guong|wc|vesinh)\b/
        group = 'wc'
      elsif f =~ /\b(may lanh|dieu hoa|ac|o dien|cong tac|den|rem|curtain|quat)\b/
        group = 'elec'
      end

      sym = case f
            when /giuong|bed/ then 'bed'
            when /tu ao.*lua|lua/ then 'wardrobe_slide'
            when /tu ao|wardrobe/ then 'wardrobe'
            when /sofa.*goc|sofa.*l/ then 'sofaL'
            when /sofa/ then 'sofa'
            when /armchair/ then 'armchair'
            when /ban tra|coffee/ then 'coffee'
            when /ke tv|tvstand/ then 'tvstand'
            when /\btv\b|tivi/ then 'tv'
            when /ban an|dining|table/ then 'table'
            when /tu bep.*tren|treo/ then 'cab_wall'
            when /bep|kitchen/ then 'kitchen_base'
            when /dao bep|island/ then 'island'
            when /tu lanh|fridge/ then 'fridge'
            when /chau rua|sink/ then 'sink'
            when /hut mui|hood/ then 'hood'
            when /bon cau|toilet/ then 'toilet'
            when /lavabo|basin/ then 'basin'
            when /bon tam|bathtub/ then 'tub'
            when /may giat|washer/ then 'washer'
            when /may lanh|dieu hoa/ then 'ac_wall'
            when /ban tho|altar/ then 'altar'
            when /ban lam viec|desk/ then 'desk'
            when /trang diem|dresser/ then 'dresser'
            when /tap|nightstand/ then 'nightstand'
            else 'cab'
            end

      if f =~ /am tran|ceiling|den hat|hop rem/
        mount = 'ceiling'
      elsif min_z_mm >= 250 || f =~ /treo|wall|tivi|\btv\b|may lanh|dieu hoa|hut mui|tu guong/
        mount = 'wall'
      end

      back = false if f =~ /ban an|dining|ban tra|coffee|dao bep|island|tham|rug|cay xanh|plant|armchair|don/
      z_val = mount == 'floor' ? 0 : [0, min_z_mm].max

      {
        'group' => group,
        'sym'   => sym,
        'mount' => mount,
        'back'  => back,
        'z'     => z_val,
        'h_hint' => h_mm
      }
    end

    def collect_targets(model)
      sel_entities = model.selection.select do |e|
        e.valid? && (e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group))
      end

      base_name = File.basename(model.path.to_s, '.*')
      base_name = 'Mau_SketchUp' if base_name.empty?

      if !sel_entities.empty?
        return sel_entities.each_with_index.map do |ent, idx|
          defn = definition_of(ent)
          raw_name = ent.name.to_s.strip
          raw_name = defn.name.to_s.strip if raw_name.empty? && defn
          raw_name = "#{base_name}_#{idx + 1}" if raw_name.empty?
          clean_name = raw_name.gsub(/#\d+\z/, '').strip
          clean_name = raw_name if clean_name.empty?
          bb = ent.bounds
          min_z_mm = [0, bb.min.z.to_mm.round].max
          h_mm = [10, (bb.max.z - bb.min.z).to_mm.round].max
          meta = guess_metadata(clean_name, min_z_mm, h_mm)
          {
            entity: ent,
            id: "t_#{idx}",
            name: clean_name,
            group: meta['group'],
            sym: meta['sym'],
            mount: meta['mount'],
            back: meta['back'],
            z: meta['z']
          }
        end
      end

      has_faces = model.entities.any? { |e| e.valid? && (e.is_a?(Sketchup::Face) || e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)) }
      return [] unless has_faces

      bb = model.bounds
      min_z_mm = [0, bb.min.z.to_mm.round].max
      h_mm = [10, (bb.max.z - bb.min.z).to_mm.round].max
      meta = guess_metadata(base_name, min_z_mm, h_mm)
      [
        {
          entity: nil,
          id: 't_0',
          name: base_name,
          group: meta['group'],
          sym: meta['sym'],
          mount: meta['mount'],
          back: meta['back'],
          z: meta['z']
        }
      ]
    end

    def extract_local_scales(tr)
      origin = Geom::Point3d.new(0, 0, 0).transform(tr)
      vx = Geom::Point3d.new(1, 0, 0).transform(tr) - origin
      vy = Geom::Point3d.new(0, 1, 0).transform(tr) - origin
      vz = Geom::Point3d.new(0, 0, 1).transform(tr) - origin
      sx = vx.length
      sy = vy.length
      sz = vz.length
      sx = 1.0 if sx < 1e-6
      sy = 1.0 if sy < 1e-6
      sz = 1.0 if sz < 1e-6
      sx = -sx if vx.cross(vy).dot(vz) < 0
      [sx, sy, sz]
    end

    def front_axis_radians(front_axis, entity_tr = nil)
      case front_axis.to_s
      when '+Y'
        Math::PI
      when '-X'
        -Math::PI / 2.0
      when '+X'
        Math::PI / 2.0
      when 'WORLD'
        if entity_tr
          origin = Geom::Point3d.new(0, 0, 0).transform(entity_tr)
          vx = Geom::Point3d.new(1, 0, 0).transform(entity_tr) - origin
          Math.atan2(vx.y, vx.x)
        else
          0.0
        end
      else
        0.0
      end
    end

    # Tính BoundingBox thực sự theo hình học hiển thị (tránh padding vô hình)
    def compute_entities_bbox(entities, tr = Geom::Transformation.new, bb = Geom::BoundingBox.new)
      entities.each do |ent|
        next unless ent.valid?
        next if ent.hidden?
        next if ent.layer && !ent.layer.visible?

        if ent.is_a?(Sketchup::Edge)
          bb.add(ent.start.position.transform(tr))
          bb.add(ent.end.position.transform(tr))
        elsif ent.is_a?(Sketchup::Face)
          ent.vertices.each { |v| bb.add(v.position.transform(tr)) }
        elsif ent.is_a?(Sketchup::Group)
          compute_entities_bbox(ent.entities, tr * ent.transformation, bb)
        elsif ent.is_a?(Sketchup::ComponentInstance)
          compute_entities_bbox(ent.definition.entities, tr * ent.transformation, bb)
        end
      end
      bb
    end

    def collect_2d_segments(entities, tr, segments)
      entities.each do |ent|
        next unless ent.valid?
        next if ent.hidden?
        next if ent.layer && !ent.layer.visible?

        if ent.is_a?(Sketchup::Edge)
          faces = ent.faces.select { |f| f.valid? && !f.hidden? && (!f.layer || f.layer.visible?) }
          keep = !ent.soft? && !ent.smooth?
          keep ||= faces.length <= 1
          if !keep && faces.length == 2
            n1 = faces[0].normal.transform(tr)
            n2 = faces[1].normal.transform(tr)
            n1.normalize! if n1.length > 1e-6
            n2.normalize! if n2.length > 1e-6
            # Đường bao chân trời khi nhìn từ trên xuống (+Z / -Z đổi dấu qua ngưỡng)
            keep = (n1.z >= 0.05 && n2.z < 0.05) || (n2.z >= 0.05 && n1.z < 0.05) ||
                   (n1.z <= -0.05 && n2.z > -0.05) || (n2.z <= -0.05 && n1.z > -0.05)
          end
          next unless keep

          p1 = ent.start.position.transform(tr)
          p2 = ent.end.position.transform(tr)
          segments << [p1.x.to_mm, p1.y.to_mm, p2.x.to_mm, p2.y.to_mm]
        elsif ent.is_a?(Sketchup::Group)
          collect_2d_segments(ent.entities, tr * ent.transformation, segments)
        elsif ent.is_a?(Sketchup::ComponentInstance)
          collect_2d_segments(ent.definition.entities, tr * ent.transformation, segments)
        end
      end
    end

    def extract_top_svg(entities, bb_min_x_mm, bb_max_y_mm, w_mm, d_mm)
      raw_segs = []
      collect_2d_segments(entities, Geom::Transformation.new, raw_segs)
      return '' if raw_segs.empty?

      dedup = {}
      raw_segs.each do |x1, y1, x2, y2|
        sx1 = x1 - bb_min_x_mm
        sy1 = bb_max_y_mm - y1
        sx2 = x2 - bb_min_x_mm
        sy2 = bb_max_y_mm - y2
        len2 = (sx2 - sx1) * (sx2 - sx1) + (sy2 - sy1) * (sy2 - sy1)
        next if len2 < 16.0 # bỏ nét < 4mm

        qx1 = (sx1 / 2.0).round * 2
        qy1 = (sy1 / 2.0).round * 2
        qx2 = (sx2 / 2.0).round * 2
        qy2 = (sy2 / 2.0).round * 2
        next if qx1 == qx2 && qy1 == qy2

        key = if [qx1, qy1] <= [qx2, qy2]
                "#{qx1},#{qy1}:#{qx2},#{qy2}"
              else
                "#{qx2},#{qy2}:#{qx1},#{qy1}"
              end
        prev = dedup[key]
        if prev.nil? || len2 > prev[4]
          dedup[key] = [sx1.round(1), sy1.round(1), sx2.round(1), sy2.round(1), len2]
        end
      end

      list = dedup.values
      return '' if list.empty?

      if list.length > 600
        list = list.sort_by { |s| -s[4] }.first(600)
      end

      lines_xml = list.map do |x1, y1, x2, y2, _|
        %(  <line x1="#{x1}" y1="#{y1}" x2="#{x2}" y2="#{y2}" />)
      end.join("\n")

      <<~SVG.strip
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 #{w_mm} #{d_mm}" fill="none" stroke="currentColor" stroke-width="1.2">
        #{lines_xml}
        </svg>
      SVG
    end

    def percent_decode(str)
      str.to_s.gsub(/%([0-9A-Fa-f]{2})/) { [Regexp.last_match(1).to_i(16)].pack('C') }
    end

    def xml_escape(str)
      str.to_s
         .gsub('&', '&amp;')
         .gsub('<', '&lt;')
         .gsub('>', '&gt;')
         .gsub('"', '&quot;')
         .gsub("'", '&apos;')
    end

    def mime_for_ext(path)
      case File.extname(path).downcase
      when '.png' then 'image/png'
      when '.jpg', '.jpeg' then 'image/jpeg'
      when '.webp' then 'image/webp'
      when '.gif' then 'image/gif'
      when '.bmp' then 'image/bmp'
      else nil
      end
    end

    def resolve_collada_image_path(dae_dir, raw_ref)
      cleaned = percent_decode(raw_ref.to_s.strip)
      return nil if cleaned.empty? || cleaned.start_with?('data:')

      if cleaned.start_with?('file:///')
        cleaned = cleaned.sub(%r{\Afile:///}, '')
        cleaned = "/#{cleaned}" unless cleaned =~ /\A[A-Za-z]:/
      elsif cleaned.start_with?('file://')
        cleaned = cleaned.sub(%r{\Afile://}, '')
      end

      candidates = [
        cleaned,
        File.join(dae_dir, cleaned),
        File.join(dae_dir, File.basename(cleaned))
      ]
      candidates.find { |p| File.exist?(p) && File.file?(p) }
    end

    def embed_dae_textures(dae_xml, dae_dir)
      total_embedded = 0
      max_single = 2_600_000
      max_total  = 8_000_000

      dae_xml.gsub(%r{<init_from>(.*?)</init_from>}m) do |full_match|
        inner = Regexp.last_match(1).to_s.strip
        img_path = resolve_collada_image_path(dae_dir, inner)
        mime = img_path ? mime_for_ext(img_path) : nil
        if img_path && mime
          sz = File.size(img_path)
          if sz > 0 && sz <= max_single && (total_embedded + sz) <= max_total
            total_embedded += sz
            b64 = Base64.strict_encode64(File.binread(img_path))
            "<init_from>data:#{mime};base64,#{b64}</init_from>"
          else
            full_match
          end
        else
          full_match
        end
      end
    end

    def collect_mesh_triangles(entities, tr, inherited_mat, buckets)
      entities.each do |ent|
        next unless ent.valid?
        next if ent.hidden?
        next if ent.layer && !ent.layer.visible?

        if ent.is_a?(Sketchup::Face)
          mat = ent.material || inherited_mat
          color_key, rgba = material_color_spec(mat)
          buckets[color_key] ||= { rgba: rgba, name: mat ? mat.display_name : 'MKG_Default', positions: [], normals: [], indices: [] }
          b = buckets[color_key]
          mesh = ent.mesh(4) # 4 = Normals (triangulated)
          next if mesh.count_polygons <= 0

          base_idx = b[:positions].length / 3
          (1..mesh.count_points).each do |pi|
            pt = mesh.point_at(pi).transform(tr)
            nm = mesh.normal_at(pi).transform(tr)
            nm.normalize! if nm.length > 1e-6
            b[:positions].push(pt.x.to_m.round(5), pt.y.to_m.round(5), pt.z.to_m.round(5))
            b[:normals].push(nm.x.round(4), nm.y.round(4), nm.z.round(4))
          end
          mesh.polygons.each do |poly|
            next unless poly.length >= 3
            (1...(poly.length - 1)).each do |k|
              b[:indices].push(base_idx + poly[0].abs - 1, base_idx + poly[k].abs - 1, base_idx + poly[k + 1].abs - 1)
            end
          end
        elsif ent.is_a?(Sketchup::Group)
          mat = ent.material || inherited_mat
          collect_mesh_triangles(ent.entities, tr * ent.transformation, mat, buckets)
        elsif ent.is_a?(Sketchup::ComponentInstance)
          mat = ent.material || inherited_mat
          collect_mesh_triangles(ent.definition.entities, tr * ent.transformation, mat, buckets)
        end
      end
    end

    def material_color_spec(mat)
      return ['default', [0.88, 0.89, 0.91, 1.0]] unless mat && mat.color
      c = mat.color
      alpha = mat.respond_to?(:alpha) ? mat.alpha.to_f : 1.0
      rgba = [(c.red / 255.0).round(3), (c.green / 255.0).round(3), (c.blue / 255.0).round(3), alpha.round(3)]
      [rgba.join('_'), rgba]
    end

    # Bộ xuất COLLADA thuần Ruby dự phòng khi SketchUp model.export thất bại
    def build_pure_ruby_dae(entities, root_mat = nil)
      buckets = {}
      collect_mesh_triangles(entities, Geom::Transformation.new, root_mat, buckets)
      return nil if buckets.empty?

      effects_xml = +''
      mats_xml = +''
      bind_mats_xml = +''
      positions = []
      normals = []
      triangles_xml = +''
      vert_offset = 0

      buckets.values.each_with_index do |b, idx|
        next if b[:indices].empty?
        mat_id = "mat_#{idx}"
        fx_id = "fx_#{idx}"
        r, g, bl, a = b[:rgba]

        effects_xml << <<~XML
          <effect id="#{fx_id}">
            <profile_COMMON>
              <technique sid="common">
                <lambert>
                  <diffuse><color>#{r} #{g} #{bl} #{a}</color></diffuse>
                </lambert>
              </technique>
            </profile_COMMON>
          </effect>
        XML

        mats_xml << <<~XML
          <material id="#{mat_id}" name="#{xml_escape(b[:name])}">
            <instance_effect url="##{fx_id}" />
          </material>
        XML

        bind_mats_xml << %(<instance_material symbol="#{mat_id}" target="##{mat_id}" />\n)

        tri_count = b[:indices].length / 3
        shifted = b[:indices].map { |v| v + vert_offset }
        p_str = shifted.flat_map { |v| [v, v] }.join(' ')
        triangles_xml << <<~XML
          <triangles count="#{tri_count}" material="#{mat_id}">
            <input semantic="VERTEX" source="#mesh-verts" offset="0" />
            <input semantic="NORMAL" source="#mesh-norms" offset="1" />
            <p>#{p_str}</p>
          </triangles>
        XML

        positions.concat(b[:positions])
        normals.concat(b[:normals])
        vert_offset += b[:positions].length / 3
      end

      return nil if positions.empty?

      <<~COLLADA
        <?xml version="1.0" encoding="utf-8"?>
        <COLLADA xmlns="http://www.collada.org/2005/08/collada_schema" version="1.4.1">
          <asset>
            <unit name="meter" meter="1" />
            <up_axis>Z_UP</up_axis>
          </asset>
          <library_effects>
            #{effects_xml}
          </library_effects>
          <library_materials>
            #{mats_xml}
          </library_materials>
          <library_geometries>
            <geometry id="mesh-geom" name="MKGMesh">
              <mesh>
                <source id="mesh-pos">
                  <float_array id="mesh-pos-arr" count="#{positions.length}">#{positions.join(' ')}</float_array>
                  <technique_common>
                    <accessor source="#mesh-pos-arr" count="#{positions.length / 3}" stride="3">
                      <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
                    </accessor>
                  </technique_common>
                </source>
                <source id="mesh-norms">
                  <float_array id="mesh-norms-arr" count="#{normals.length}">#{normals.join(' ')}</float_array>
                  <technique_common>
                    <accessor source="#mesh-norms-arr" count="#{normals.length / 3}" stride="3">
                      <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
                    </accessor>
                  </technique_common>
                </source>
                <vertices id="mesh-verts">
                  <input semantic="POSITION" source="#mesh-pos" />
                </vertices>
                #{triangles_xml}
              </mesh>
            </geometry>
          </library_geometries>
          <library_visual_scenes>
            <visual_scene id="Scene" name="Scene">
              <node id="MKGModel" name="MKGModel" type="NODE">
                <instance_geometry url="#mesh-geom">
                  <bind_material>
                    <technique_common>
                      #{bind_mats_xml}
                    </technique_common>
                  </bind_material>
                </instance_geometry>
              </node>
            </visual_scene>
          </library_visual_scenes>
          <scene>
            <instance_visual_scene url="#Scene" />
          </scene>
        </COLLADA>
      COLLADA
    end

    def export_single_target(model, target, options)
      tmp_dir = Dir.mktmpdir('mkg_skp_')
      dae_path = File.join(tmp_dir, 'model.dae')
      include_svg = options['include_svg'] != false
      include_textures = options['include_textures'] != false
      front_axis = options['front_axis'] || '-Y'

      ent = target[:entity]
      w_mm = 600
      d_mm = 600
      h_mm = 800
      svg2d = ''
      dae_xml = nil

      model.start_operation('MKG Temp Export', true)
      begin
        # Thoát active editing context nếu đang mở sâu bên trong group
        model.close_active while model.active_path && !model.active_path.empty?

        model.selection.clear

        if ent
          defn = definition_of(ent)
          raise 'Không tìm thấy Definition của đối tượng được chọn' unless defn

          model.entities.each do |top|
            top.hidden = true if top.valid?
          end

          temp_grp = model.entities.add_group
          temp_grp.layer = model.layers[0] if model.layers[0]
          sx, sy, sz = extract_local_scales(ent.transformation)
          rot_rad = front_axis_radians(front_axis, ent.transformation)

          inst_tr = Geom::Transformation.rotation(ORIGIN, Z_AXIS, rot_rad) *
                    Geom::Transformation.scaling(ORIGIN, sx, sy, sz)
          temp_inst = temp_grp.entities.add_instance(defn, inst_tr)
          if ent.respond_to?(:material) && ent.material
            temp_inst.material = ent.material
          end

          bb = compute_entities_bbox(temp_grp.entities)
          bb = temp_grp.bounds if bb.empty?

          cx = (bb.min.x + bb.max.x) / 2.0
          cy = (bb.min.y + bb.max.y) / 2.0
          mz = bb.min.z
          temp_grp.transform!(Geom::Transformation.translation(Geom::Vector3d.new(-cx, -cy, -mz)))

          bb = compute_entities_bbox(temp_grp.entities)
          bb = temp_grp.bounds if bb.empty?

          w_mm = [20, (bb.max.x - bb.min.x).to_mm.round].max
          d_mm = [20, (bb.max.y - bb.min.y).to_mm.round].max
          h_mm = [10, (bb.max.z - bb.min.z).to_mm.round].max

          if include_svg
            svg2d = extract_top_svg(temp_grp.entities, bb.min.x.to_mm, bb.max.y.to_mm, w_mm, d_mm)
          end

          model.selection.add(temp_grp)
          export_opts = {
            :triangulated_faces  => true,
            :double_sided_faces  => false,
            :edges               => false,
            :hidden_geometry     => false,
            :author_attribution  => false,
            :texture_maps        => include_textures,
            :selectionset_only   => true
          }
          ok = model.export(dae_path, export_opts)
          if ok && File.exist?(dae_path) && File.size(dae_path) > 100
            raw_xml = File.read(dae_path, encoding: 'UTF-8')
            dae_xml = include_textures ? embed_dae_textures(raw_xml, tmp_dir) : raw_xml
          else
            dae_xml = build_pure_ruby_dae(temp_grp.entities, ent.respond_to?(:material) ? ent.material : nil)
          end
        else
          # Xuất toàn bộ model hiện hành
          bb = compute_entities_bbox(model.entities)
          bb = model.bounds if bb.empty?
          w_mm = [20, (bb.max.x - bb.min.x).to_mm.round].max
          d_mm = [20, (bb.max.y - bb.min.y).to_mm.round].max
          h_mm = [10, (bb.max.z - bb.min.z).to_mm.round].max

          if include_svg
            svg2d = extract_top_svg(model.entities, bb.min.x.to_mm, bb.max.y.to_mm, w_mm, d_mm)
          end

          export_opts = {
            :triangulated_faces  => true,
            :double_sided_faces  => false,
            :edges               => false,
            :hidden_geometry     => false,
            :author_attribution  => false,
            :texture_maps        => include_textures,
            :selectionset_only   => false
          }
          ok = model.export(dae_path, export_opts)
          if ok && File.exist?(dae_path) && File.size(dae_path) > 100
            raw_xml = File.read(dae_path, encoding: 'UTF-8')
            dae_xml = include_textures ? embed_dae_textures(raw_xml, tmp_dir) : raw_xml
          else
            dae_xml = build_pure_ruby_dae(model.entities)
          end
        end
      ensure
        model.abort_operation
        FileUtils.remove_entry(tmp_dir) if tmp_dir && File.exist?(tmp_dir)
      end

      raise "Không trích xuất được hình học 3D cho \"#{target[:name]}\"" unless dae_xml && !dae_xml.empty?

      slug = slugify(target[:name])
      b64 = Base64.strict_encode64(dae_xml.encode('UTF-8'))
      {
        'name'        => target[:name],
        'group'       => target[:group],
        'sym'         => target[:sym],
        'w'           => w_mm,
        'd'           => d_mm,
        'h'           => h_mm,
        'z'           => target[:z].to_i,
        'mount'       => target[:mount],
        'back'        => !!target[:back],
        'svg2d'       => svg2d,
        'modelFormat' => 'dae',
        'glbFileName' => "#{slug}.dae",
        'glbData'     => "data:model/vnd.collada+xml;base64,#{b64}",
        'daeXml'      => dae_xml
      }
    end

    def perform_export_mkglib(model, targets, payload)
      selected_map = {}
      (payload['items'] || []).each { |row| selected_map[row['id']] = row if row['enabled'] != false }

      chosen_targets = if selected_map.empty?
                         targets
                       else
                         targets.select { |t| selected_map.key?(t[:id]) }.map do |t|
                           row = selected_map[t[:id]]
                           t.merge(
                             name: row['name'].to_s.strip.empty? ? t[:name] : row['name'].to_s.strip,
                             group: row['group'] || t[:group],
                             mount: row['mount'] || t[:mount],
                             z: row['z'].to_i,
                             back: !!row['back']
                           )
                         end
                       end

      if chosen_targets.empty?
        UI.messagebox('Chưa có món nào được tích chọn để xuất.')
        return false
      end

      default_file = chosen_targets.length == 1 ? "#{slugify(chosen_targets[0][:name])}.mkglib.json" : 'MKG_ThuVien_SketchUp.mkglib.json'
      out_path = UI.savepanel('Lưu gói Thư viện MKG (.mkglib.json)', '', default_file)
      return false unless out_path && !out_path.empty?

      out_path = "#{out_path}.mkglib.json" unless out_path.downcase.end_with?('.json')

      exported_items = chosen_targets.map do |t|
        res = export_single_target(model, t, payload)
        res.delete('daeXml')
        res
      end

      pkg = {
        'app'        => 'MKG_SKETCHUP_EXPORT',
        'version'    => 1,
        'exportedAt' => Time.now.utc.iso8601,
        'exporter'   => "#{PLUGIN_ID}/#{PLUGIN_VERSION}",
        'items'      => exported_items
      }

      File.write(out_path, JSON.pretty_generate(pkg), encoding: 'UTF-8')
      UI.messagebox(
        "Đã xuất thành công #{exported_items.length} món nội thất!\n\n" \
        "File: #{out_path}\n\n" \
        "Mở https://do.mkg.vn/?backend=1 trên máy tính → bấm \"Nhập từ SketchUp\" hoặc kéo thả file này vào trình duyệt."
      )
      true
    rescue StandardError => e
      UI.messagebox("Lỗi khi xuất thư viện MKG:\n#{e.message}")
      false
    end

    def quick_export_dae
      model = Sketchup.active_model
      return unless model

      targets = collect_targets(model)
      if targets.empty?
        UI.messagebox('Hãy mở model hoặc chọn 1 Group/Component cần xuất sang .DAE!')
        return
      end

      target = targets[0]
      default_file = "#{slugify(target[:name])}.dae"
      out_path = UI.savepanel('Xuất file 3D COLLADA (.dae) chuẩn MKG', '', default_file)
      return unless out_path && !out_path.empty?

      out_path = "#{out_path}.dae" unless out_path.downcase.end_with?('.dae')
      res = export_single_target(model, target, { 'include_svg' => false, 'include_textures' => true, 'front_axis' => '-Y' })
      File.write(out_path, res['daeXml'], encoding: 'UTF-8')
      UI.messagebox("Đã xuất file .DAE chuẩn trục (#{res['w']}×#{res['d']}×#{res['h']} mm):\n#{out_path}")
    rescue StandardError => e
      UI.messagebox("Lỗi xuất .DAE: #{e.message}")
    end

    def show_guide_dialog
      UI.messagebox(
        "HƯỚNG DẪN XUẤT MODEL SKETCHUP SANG MKG KHẢO SÁT (do.mkg.vn)\n\n" \
        "1. Đóng gói mỗi món nội thất thành 1 Group hoặc Component riêng.\n" \
        "2. Hướng mặt trước (Front) về trục Xanh lá âm (-Y); chiều cao hướng lên trục Xanh dương (+Z).\n" \
        "   (Nếu model quay hướng khác, có thể chọn lại 'Hướng mặt trước' ngay trong hộp thoại xuất).\n" \
        "3. Chọn 1 hoặc nhiều món cùng lúc → vào Extensions → MKG Khảo Sát (hoặc chuột phải) → Xuất .mkglib.json.\n" \
        "4. Trên trình duyệt máy tính mở https://do.mkg.vn/?backend=1 → kéo thả file .mkglib.json vào là tự động lên đủ 2D CAD SVG + 3D + kích thước mm!"
      )
    end

    def open_export_dialog
      model = Sketchup.active_model
      return unless model

      targets = collect_targets(model)
      if targets.empty?
        UI.messagebox(
          "Không tìm thấy đối tượng nào để xuất.\n\n" \
          "Hãy chọn 1 hoặc nhiều Group / Component nội thất rồi thử lại!"
        )
        return
      end

      unless defined?(UI::HtmlDialog)
        # Fallback cho SketchUp rất cũ không có HtmlDialog
        t0 = targets[0]
        prompts = ['Tên món:', 'Nhóm (bedroom/living/kitchen/wc/elec/other):', 'Kiểu lắp (floor/wall/ceiling):', 'Cao độ Z (mm):', 'Áp tường (true/false):']
        defaults = [t0[:name], t0[:group], t0[:mount], t0[:z].to_s, t0[:back].to_s]
        ans = UI.inputbox(prompts, defaults, 'MKG Khảo Sát — Xuất .mkglib.json')
        return unless ans
        t0[:name] = ans[0]
        t0[:group] = ans[1]
        t0[:mount] = ans[2]
        t0[:z] = ans[3].to_i
        t0[:back] = ans[4].to_s.downcase == 'true'
        perform_export_mkglib(model, [t0], { 'include_svg' => true, 'include_textures' => true, 'front_axis' => '-Y', 'items' => [] })
        return
      end

      init_data = {
        'items' => targets.map do |t|
          {
            'id' => t[:id],
            'name' => t[:name],
            'group' => t[:group],
            'mount' => t[:mount],
            'z' => t[:z],
            'back' => t[:back],
            'enabled' => true
          }
        end,
        'groups' => GROUPS
      }

      dlg = UI::HtmlDialog.new(
        dialog_title: 'MKG Khảo Sát — Xuất Thư Viện 2D & 3D',
        preferences_key: 'com.mkg.khaosat.exporter',
        scrollable: true,
        resizable: true,
        width: 720,
        height: 540,
        min_width: 560,
        min_height: 420
      )

      dlg.add_action_callback('exportMkg') do |_ctx, json_str|
        payload = JSON.parse(json_str.to_s)
        dlg.close
        perform_export_mkglib(model, targets, payload)
      end

      dlg.add_action_callback('cancelDialog') do |_ctx|
        dlg.close
      end

      dlg.set_html(build_dialog_html(init_data))
      dlg.center
      dlg.show
    end

    def build_dialog_html(init_data)
      json_bootstrap = JSON.generate(init_data).gsub('</', '<\/')
      <<~HTML
        <!doctype html>
        <html lang="vi">
        <head>
        <meta charset="utf-8" />
        <title>MKG Khảo Sát Exporter</title>
        <style>
          * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
          body { margin: 0; padding: 14px 16px; background: #f8fafc; color: #0f172a; font-size: 13px; }
          .hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
          .hdr h2 { margin: 0; font-size: 16px; color: #0f172a; }
          .hdr small { color: #475569; font-size: 11.5px; }
          .opts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
          .opt-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
          .opt-item label { font-weight: 600; color: #334155; }
          .chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; padding-top: 14px; }
          select, input[type="text"], input[type="number"] { padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12.5px; width: 100%; background: #fff; }
          .tbl-wrap { max-height: 290px; overflow: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; font-size: 12.5px; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; position: sticky; top: 0; z-index: 2; }
          td.center, th.center { text-align: center; }
          .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
          .note { color: #64748b; font-size: 11.5px; }
          .btns { display: flex; gap: 8px; }
          button { padding: 8px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-weight: 600; font-size: 13px; }
          button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
          button.primary:hover { background: #1d4ed8; }
        </style>
        </head>
        <body>
          <div class="hdr">
            <div>
              <h2>Xuất sang Thư viện 2D &amp; 3D — MKG Khảo Sát</h2>
              <small>Chuẩn hoá toạ độ tâm đáy (0,0,0), đơn vị mm, tự trích nét 2D SVG chiếu bằng + mô hình 3D COLLADA</small>
            </div>
          </div>

          <div class="opts">
            <div class="opt-item">
              <label for="frontAxis">Hướng mặt trước trong SketchUp</label>
              <select id="frontAxis">
                <option value="-Y">Mặc định Front (-Y nhìn vào)</option>
                <option value="+Y">Quay ngược 180° (+Y)</option>
                <option value="-X">Mặt trước bên Trái (-X)</option>
                <option value="+X">Mặt trước bên Phải (+X)</option>
                <option value="WORLD">Giữ nguyên góc xoay hiện tại</option>
              </select>
            </div>
            <label class="chk"><input type="checkbox" id="incSvg" checked /> Tự trích nét mặt bằng 2D SVG</label>
            <label class="chk"><input type="checkbox" id="incTex" checked /> Nhúng ảnh vật liệu Texture</label>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th class="center" style="width:34px"><input type="checkbox" id="chkAll" checked /></th>
                  <th>Tên món nội thất</th>
                  <th style="width:120px">Nhóm phòng</th>
                  <th style="width:110px">Kiểu lắp</th>
                  <th style="width:74px">Z (mm)</th>
                  <th class="center" style="width:68px">Áp tường</th>
                </tr>
              </thead>
              <tbody id="rows"></tbody>
            </table>
          </div>

          <div class="foot">
            <div class="note" id="summary"></div>
            <div class="btns">
              <button type="button" onclick="sketchup.cancelDialog()">Huỷ</button>
              <button type="button" class="primary" onclick="doExport()">Xuất file .mkglib.json</button>
            </div>
          </div>

          <script>
            const DATA = #{json_bootstrap};
            const tbody = document.getElementById('rows');
            const summary = document.getElementById('summary');
            const chkAll = document.getElementById('chkAll');

            function render() {
              tbody.innerHTML = '';
              DATA.items.forEach((it, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                  <td class="center"><input type="checkbox" data-idx="${idx}" class="row-chk" ${it.enabled ? 'checked' : ''} /></td>
                  <td><input type="text" value="${String(it.name).replace(/"/g, '&quot;')}" oninput="DATA.items[${idx}].name=this.value" /></td>
                  <td>
                    <select onchange="DATA.items[${idx}].group=this.value">
                      ${DATA.groups.map(g => `<option value="${g.key}" ${g.key === it.group ? 'selected' : ''}>${g.name}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <select onchange="DATA.items[${idx}].mount=this.value">
                      <option value="floor" ${it.mount === 'floor' ? 'selected' : ''}>Đặt sàn</option>
                      <option value="wall" ${it.mount === 'wall' ? 'selected' : ''}>Treo tường</option>
                      <option value="ceiling" ${it.mount === 'ceiling' ? 'selected' : ''}>Âm trần</option>
                    </select>
                  </td>
                  <td><input type="number" min="0" value="${it.z}" oninput="DATA.items[${idx}].z=Number(this.value)||0" /></td>
                  <td class="center"><input type="checkbox" ${it.back ? 'checked' : ''} onchange="DATA.items[${idx}].back=this.checked" /></td>
                `;
                tbody.appendChild(tr);
              });
              tbody.querySelectorAll('.row-chk').forEach(el => {
                el.addEventListener('change', (e) => {
                  DATA.items[Number(e.target.dataset.idx)].enabled = e.target.checked;
                  updateSummary();
                });
              });
              updateSummary();
            }

            function updateSummary() {
              const cnt = DATA.items.filter(x => x.enabled).length;
              summary.textContent = `Đã chọn ${cnt} / ${DATA.items.length} đối tượng để đóng gói`;
            }

            chkAll.addEventListener('change', () => {
              DATA.items.forEach(it => { it.enabled = chkAll.checked; });
              render();
            });

            function doExport() {
              const payload = {
                front_axis: document.getElementById('frontAxis').value,
                include_svg: document.getElementById('incSvg').checked,
                include_textures: document.getElementById('incTex').checked,
                items: DATA.items
              };
              sketchup.exportMkg(JSON.stringify(payload));
            }

            render();
          </script>
        </body>
        </html>
      HTML
    end

    unless file_loaded?(__FILE__)
      cmd_pkg = UI::Command.new('Xuất gói Thư viện MKG (.mkglib.json)') { open_export_dialog }
      cmd_pkg.tooltip = 'MKG Khảo Sát: Xuất Group/Component đang chọn sang Thư viện 2D + 3D (.mkglib.json)'
      cmd_pkg.status_bar_text = 'Xuất 1 hoặc nhiều món nội thất từ SketchUp sang gói thư viện do.mkg.vn'
      cmd_pkg.menu_text = 'Xuất sang Thư viện MKG (.mkglib.json) — 2D + 3D chuẩn'

      icon_24 = File.join(plugin_dir, 'icons', 'mkg_24.png')
      icon_32 = File.join(plugin_dir, 'icons', 'mkg_32.png')
      cmd_pkg.small_icon = icon_24 if File.exist?(icon_24)
      cmd_pkg.large_icon = icon_32 if File.exist?(icon_32)

      cmd_dae = UI::Command.new('Xuất nhanh 3D COLLADA (.dae)') { quick_export_dae }
      cmd_dae.tooltip = 'Xuất nhanh 1 món sang .dae chuẩn hoá gốc toạ độ'

      cmd_help = UI::Command.new('Hướng dẫn hệ trục & Model') { show_guide_dialog }

      menu = UI.menu('Extensions').add_submenu('MKG Khảo Sát (do.mkg.vn)')
      menu.add_item(cmd_pkg)
      menu.add_item(cmd_dae)
      menu.add_separator
      menu.add_item(cmd_help)

      toolbar = UI::Toolbar.new('MKG Khảo Sát')
      toolbar.add_item(cmd_pkg)
      toolbar.restore

      UI.add_context_menu_handler do |context_menu|
        model = Sketchup.active_model
        next unless model
        has_comp = model.selection.any? do |e|
          e.valid? && (e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group))
        end
        if has_comp
          context_menu.add_separator
          context_menu.add_item('MKG Khảo Sát: Xuất món này ra Thư viện 2D/3D (.mkglib.json)') { open_export_dialog }
        end
      end

      file_loaded(__FILE__)
    end
  end
end

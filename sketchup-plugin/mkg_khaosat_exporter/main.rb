# encoding: UTF-8
# MKG Khảo Sát — SketchUp Extension Main Module (v1.1.0)
# Chỉ xuất khối Solid & Màu sắc (tự loại bỏ Tag Label, liên kết, chữ, kích thước, texture ảnh)
# Hỗ trợ đẩy trực tiếp lên Thư viện do.mkg.vn (không cần mở Backend) + xuất .mkglib.json
# Tương thích SketchUp 2017 -> 2026 (Windows & macOS, Ruby 2.2 -> Ruby 3.2+)

require 'sketchup.rb'
require 'json'
require 'base64'
require 'time'
require 'net/http'
require 'uri'
require 'openssl'

module MKG
  module KhaoSatExporter
    extend self

    GROUPS = [
      { 'key' => 'bedroom', 'name' => 'Phòng ngủ' },
      { 'key' => 'living',  'name' => 'Khách + ăn' },
      { 'key' => 'kitchen', 'name' => 'Bếp' },
      { 'key' => 'wc',      'name' => 'WC' },
      { 'key' => 'elec',    'name' => 'Điện & TB' },
      { 'key' => 'other',   'name' => 'Khác' },
      { 'key' => 'fadi',    'name' => 'Thư viện FADI' }
    ].freeze unless defined?(GROUPS)

    JUNK_NAME_RE = Regexp.new(
      '(?:\b(?:' \
      'abf|betagon|label|3d text|text|dim|dimension|kich thuoc|ky hieu|symbol|' \
      'arrow|mui ten|grain|van go|swing|net mo|open line|annot|annotation|ghi chu|' \
      'ma tam|chi canh|dan canh|edgeband|lien ket|oc cam|cam chot|chot|dowel|' \
      'minifix|rafix|cabineo|clamex|lamello|khoan|drill|hole|cnc|groove|ranh|' \
      'vit|screw|bolt|bulong|connector|fitting|phu kien|hinge|ban le|runner|' \
      'ray bi|ray am|laser|helper|bbox|snap|origin|axis|guide' \
      ')\b|abf_?label|camchot|occam|ma_?tam|chi_?canh|edgeband|minifix|cabineo)',
      Regexp::IGNORECASE
    ) unless defined?(JUNK_NAME_RE)

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

    def junk_tag_name?(layer)
      return false unless layer
      name = layer.respond_to?(:name) ? layer.name.to_s : layer.to_s
      return false if name.empty? || name == 'Layer0' || name == 'Untagged'
      !!(fold_vn(name) =~ JUNK_NAME_RE)
    end

    def junk_part_name?(*names)
      names.any? do |nm|
        s = nm.to_s.strip
        !s.empty? && !!(fold_vn(s) =~ JUNK_NAME_RE)
      end
    end

    def entity_visible?(ent)
      return false unless ent && ent.valid?
      return false if ent.respond_to?(:hidden?) && ent.hidden?
      if ent.respond_to?(:layer) && ent.layer
        return false unless ent.layer.visible?
        return false if junk_tag_name?(ent.layer)
      end
      true
    end

    def guess_metadata(name, min_z_mm, h_mm)
      f = fold_vn(name)
      group = 'other'
      sym = 'cab'
      mount = 'floor'
      back = true

      if f =~ /\bfadi\b/
        group = 'fadi'
      elsif f =~ /\b(giuong|bed|tap dau giuong|nightstand|ban trang diem|dresser|tu ao|wardrobe|tu quan ao|ban lam viec|desk)\b/
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
        'group'  => group,
        'sym'    => sym,
        'mount'  => mount,
        'back'   => back,
        'z'      => z_val,
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
      sx = vx.length.to_f
      sy = vy.length.to_f
      sz = vz.length.to_f
      sx = 1.0 if sx < 1e-6
      sy = 1.0 if sy < 1e-6
      sz = 1.0 if sz < 1e-6
      sx = -sx if vx.cross(vy).dot(vz) < 0
      [sx, sy, sz]
    end

    def mirrored_transform?(tr)
      origin = Geom::Point3d.new(0, 0, 0).transform(tr)
      vx = Geom::Point3d.new(1, 0, 0).transform(tr) - origin
      vy = Geom::Point3d.new(0, 1, 0).transform(tr) - origin
      vz = Geom::Point3d.new(0, 0, 1).transform(tr) - origin
      vx.cross(vy).dot(vz) < 0
    end

    def front_axis_radians(front_axis)
      case front_axis.to_s
      when '+Y' then Math::PI
      when '-X' then -Math::PI / 2.0
      when '+X' then Math::PI / 2.0
      else 0.0
      end
    end

    def child_local_dims_mm(child, parent_tr)
      defn = definition_of(child)
      return nil unless defn
      dbb = defn.bounds
      return nil if dbb.empty?
      csx, csy, csz = extract_local_scales(parent_tr * child.transformation)
      [
        (dbb.max.x - dbb.min.x).to_mm * csx.abs,
        (dbb.max.y - dbb.min.y).to_mm * csy.abs,
        (dbb.max.z - dbb.min.z).to_mm * csz.abs
      ].sort
    end

    def container_is_manifold?(ent)
      return false unless ent && ent.respond_to?(:manifold?)
      ent.manifold?
    rescue StandardError
      false
    end

    def collect_candidate_leaves(entities, tr, inherited_mat, root_max_mm, solid_only, leaves, container_ent = nil)
      direct_faces = entities.select { |e| e.is_a?(Sketchup::Face) && entity_visible?(e) }
      unless direct_faces.empty?
        leaves << {
          entities: entities,
          faces: direct_faces,
          tr: tr,
          mat: inherited_mat,
          manifold: container_is_manifold?(container_ent)
        }
      end

      entities.each do |ent|
        next unless ent.is_a?(Sketchup::Group) || ent.is_a?(Sketchup::ComponentInstance)
        next unless entity_visible?(ent)

        defn = definition_of(ent)
        next unless defn
        next if junk_part_name?(ent.name, defn.name)

        dims = child_local_dims_mm(ent, tr)
        if dims && root_max_mm > 250.0
          # Loại nhãn dán phẳng, chữ 3D mỏng (< 1.8mm) và chốt/ốc/linh kiện nhỏ (< 42mm)
          next if dims[0] < 1.8
          next if solid_only && dims[2] < 42.0
        end

        child_mat = (ent.respond_to?(:material) && ent.material) ? ent.material : inherited_mat
        child_tr = tr * ent.transformation
        collect_candidate_leaves(defn.entities, child_tr, child_mat, root_max_mm, solid_only, leaves, ent)
      end
    end

    def compute_leaves_bbox(leaves)
      bb = Geom::BoundingBox.new
      leaves.each do |leaf|
        tr = leaf[:tr]
        leaf[:faces].each do |face|
          next unless face.valid?
          face.vertices.each { |v| bb.add(v.position.transform(tr)) }
        end
      end
      bb
    end

    def resolve_kept_leaves(model, target, options)
      solid_only = options['solid_only'] != false
      front_axis = options['front_axis'] || '-Y'
      ent = target[:entity]

      leaves = []
      if ent
        defn = definition_of(ent)
        raise 'Không tìm thấy Definition của đối tượng được chọn' unless defn

        ebb = ent.bounds
        root_max_mm = [
          (ebb.max.x - ebb.min.x).to_mm,
          (ebb.max.y - ebb.min.y).to_mm,
          (ebb.max.z - ebb.min.z).to_mm
        ].max

        base_tr = if front_axis.to_s == 'WORLD'
                    ent.transformation
                  else
                    origin_pt = Geom::Point3d.new(0, 0, 0)
                    z_vec = Geom::Vector3d.new(0, 0, 1)
                    sx, sy, sz = extract_local_scales(ent.transformation)
                    Geom::Transformation.rotation(origin_pt, z_vec, front_axis_radians(front_axis)) *
                      Geom::Transformation.scaling(origin_pt, sx, sy, sz)
                  end
        root_mat = ent.respond_to?(:material) ? ent.material : nil
        collect_candidate_leaves(defn.entities, base_tr, root_mat, root_max_mm, solid_only, leaves, ent)
      else
        mbb = model.bounds
        root_max_mm = [
          (mbb.max.x - mbb.min.x).to_mm,
          (mbb.max.y - mbb.min.y).to_mm,
          (mbb.max.z - mbb.min.z).to_mm
        ].max
        collect_candidate_leaves(model.entities, Geom::Transformation.new, nil, root_max_mm, solid_only, leaves, nil)
      end

      return [nil, nil] if leaves.empty?

      if solid_only
        solid_leaves = leaves.select { |l| l[:manifold] }
        leaves = solid_leaves unless solid_leaves.empty?
      end

      bb = compute_leaves_bbox(leaves)
      return [nil, nil] if bb.empty?

      cx = (bb.min.x + bb.max.x) / 2.0
      cy = (bb.min.y + bb.max.y) / 2.0
      mz = bb.min.z
      shift_tr = Geom::Transformation.translation(Geom::Vector3d.new(-cx, -cy, -mz))

      shifted_leaves = leaves.map { |l| l.merge(tr: shift_tr * l[:tr]) }
      norm_bb = compute_leaves_bbox(shifted_leaves)
      [shifted_leaves, norm_bb]
    end

    def extract_top_svg_from_leaves(leaves, bb_min_x_mm, bb_max_y_mm, w_mm, d_mm)
      dedup = {}

      leaves.each do |leaf|
        tr = leaf[:tr]
        seen_edges = {}
        leaf[:faces].each do |face|
          next unless face.valid?
          face.edges.each do |edge|
            eid = edge.object_id
            next if seen_edges[eid]
            seen_edges[eid] = true
            next unless entity_visible?(edge)

            efaces = edge.faces.select { |f| f.valid? && entity_visible?(f) }
            keep = !edge.soft? && !edge.smooth?
            keep ||= efaces.length <= 1
            if !keep && efaces.length == 2
              n1 = efaces[0].normal.transform(tr)
              n2 = efaces[1].normal.transform(tr)
              n1.normalize! if n1.length.to_f > 1e-6
              n2.normalize! if n2.length.to_f > 1e-6
              keep = (n1.z >= 0.05 && n2.z < 0.05) || (n2.z >= 0.05 && n1.z < 0.05) ||
                     (n1.z <= -0.05 && n2.z > -0.05) || (n2.z <= -0.05 && n1.z > -0.05)
            end
            next unless keep

            p1 = edge.start.position.transform(tr)
            p2 = edge.end.position.transform(tr)
            sx1 = p1.x.to_mm - bb_min_x_mm
            sy1 = bb_max_y_mm - p1.y.to_mm
            sx2 = p2.x.to_mm - bb_min_x_mm
            sy2 = bb_max_y_mm - p2.y.to_mm
            len2 = (sx2 - sx1) * (sx2 - sx1) + (sy2 - sy1) * (sy2 - sy1)
            next if len2 < 16.0

            qx1 = (sx1 / 2.0).round * 2
            qy1 = (sy1 / 2.0).round * 2
            qx2 = (sx2 / 2.0).round * 2
            qy2 = (sy2 / 2.0).round * 2
            next if qx1 == qx2 && qy1 == qy2

            key = if (qx1 < qx2) || (qx1 == qx2 && qy1 <= qy2)
                    "#{qx1},#{qy1}:#{qx2},#{qy2}"
                  else
                    "#{qx2},#{qy2}:#{qx1},#{qy1}"
                  end
            prev = dedup[key]
            if prev.nil? || len2 > prev[4]
              dedup[key] = [sx1.round(1), sy1.round(1), sx2.round(1), sy2.round(1), len2]
            end
          end
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

    def xml_escape(str)
      str.to_s
         .gsub('&', '&amp;')
         .gsub('<', '&lt;')
         .gsub('>', '&gt;')
         .gsub('"', '&quot;')
         .gsub("'", '&apos;')
    end

    def material_color_spec(mat)
      return ['default', [0.88, 0.89, 0.91, 1.0], 'MKG_Default'] unless mat && mat.color
      c = mat.color
      alpha = mat.respond_to?(:alpha) ? mat.alpha.to_f : 1.0
      alpha = [[alpha, 0.0].max, 1.0].min
      rgba = [(c.red / 255.0).round(3), (c.green / 255.0).round(3), (c.blue / 255.0).round(3), alpha.round(3)]
      [rgba.join('_'), rgba, mat.display_name]
    end

    def build_solid_color_dae_from_leaves(leaves)
      buckets = {}

      leaves.each do |leaf|
        tr = leaf[:tr]
        mirrored = mirrored_transform?(tr)
        root_mat = leaf[:mat]

        leaf[:faces].each do |face|
          next unless face.valid?
          mat = face.material || face.back_material || root_mat
          color_key, rgba, mat_name = material_color_spec(mat)
          buckets[color_key] ||= { rgba: rgba, name: mat_name, positions: [], normals: [], indices: [] }
          b = buckets[color_key]

          mesh = face.mesh(4)
          next if mesh.count_polygons <= 0

          base_idx = b[:positions].length / 3
          (1..mesh.count_points).each do |pi|
            pt = mesh.point_at(pi).transform(tr)
            nm = mesh.normal_at(pi).transform(tr)
            nm.normalize! if nm.length.to_f > 1e-6
            b[:positions].push(pt.x.to_m.round(5), pt.y.to_m.round(5), pt.z.to_m.round(5))
            b[:normals].push(nm.x.round(4), nm.y.round(4), nm.z.round(4))
          end

          mesh.polygons.each do |poly|
            next unless poly.length >= 3
            (1...(poly.length - 1)).each do |k|
              i0 = base_idx + poly[0].abs - 1
              i1 = base_idx + poly[k].abs - 1
              i2 = base_idx + poly[k + 1].abs - 1
              if mirrored
                b[:indices].push(i0, i2, i1)
              else
                b[:indices].push(i0, i1, i2)
              end
            end
          end
        end
      end

      return nil if buckets.empty?

      effects_xml = String.new
      mats_xml = String.new
      bind_mats_xml = String.new
      positions = []
      normals = []
      triangles_xml = String.new
      vert_offset = 0

      buckets.values.each_with_index do |b, idx|
        next if b[:indices].empty?
        mat_id = "mat_#{idx}"
        fx_id = "fx_#{idx}"
        r, g, bl, a = b[:rgba]

        trans_xml = if a < 0.99
                      %(<transparency><float>#{a}</float></transparency>)
                    else
                      ''
                    end

        effects_xml << <<~XML
          <effect id="#{fx_id}">
            <profile_COMMON>
              <technique sid="common">
                <lambert>
                  <diffuse><color>#{r} #{g} #{bl} #{a}</color></diffuse>
                  #{trans_xml}
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
      include_svg = options['include_svg'] != false
      kept_leaves, bb = resolve_kept_leaves(model, target, options)
      raise "Không tìm thấy khối Solid hợp lệ trong \"#{target[:name]}\"" unless kept_leaves && bb && !bb.empty?

      w_mm = [20, (bb.max.x - bb.min.x).to_mm.round].max
      d_mm = [20, (bb.max.y - bb.min.y).to_mm.round].max
      h_mm = [10, (bb.max.z - bb.min.z).to_mm.round].max

      svg2d = if include_svg
                extract_top_svg_from_leaves(kept_leaves, bb.min.x.to_mm, bb.max.y.to_mm, w_mm, d_mm)
              else
                ''
              end

      dae_xml = build_solid_color_dae_from_leaves(kept_leaves)
      raise "Không tạo được lưới 3D Solid cho \"#{target[:name]}\"" unless dae_xml && !dae_xml.empty?

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

    PREF_SECTION = 'MKG_KhaoSat_Exporter'.freeze unless defined?(PREF_SECTION)
    DEFAULT_API_BASE = 'https://do.mkg.vn'.freeze unless defined?(DEFAULT_API_BASE)

    def read_pref(key, fallback = '')
      v = Sketchup.read_default(PREF_SECTION, key.to_s, fallback)
      v.nil? ? fallback : v.to_s
    rescue StandardError
      fallback
    end

    def write_pref(key, val)
      Sketchup.write_default(PREF_SECTION, key.to_s, val.to_s)
    rescue StandardError
      nil
    end

    def normalize_api_base(url)
      s = url.to_s.strip.sub(%r{/+\z}, '')
      s = DEFAULT_API_BASE if s.empty?
      s = "https://#{s}" unless s.match?(%r{\Ahttps?://}i)
      s
    end

    def http_post_json(url_str, body_obj, token = nil)
      uri = URI.parse(url_str)
      http = Net::HTTP.new(uri.host, uri.port)
      http.open_timeout = 15
      http.read_timeout = 90
      if uri.scheme == 'https'
        http.use_ssl = true
        http.verify_mode = OpenSSL::SSL::VERIFY_PEER
      end
      req = Net::HTTP::Post.new(uri.request_uri)
      req['Content-Type'] = 'application/json; charset=utf-8'
      req['Accept'] = 'application/json'
      req['Authorization'] = "Bearer #{token}" if token && !token.empty?
      req.body = JSON.generate(body_obj).encode('UTF-8')
      res = http.request(req)
      raw = res.body.to_s.force_encoding('UTF-8')
      parsed = begin
        JSON.parse(raw)
      rescue StandardError
        {}
      end
      { code: res.code.to_i, data: parsed, raw: raw }
    end

    def cloud_authenticate!(base_url, identity, secret)
      ident = identity.to_s.strip
      sec = secret.to_s.strip
      raise 'Vui lòng nhập Tài khoản (Email/Username) và PIN hoặc Mật khẩu.' if ident.empty? || sec.empty?

      candidates = []
      if /\A\d{4,8}\z/.match?(sec)
        candidates << ['collections/users/auth-with-password', "mkgks-#{sec}-v1"]
        candidates << ['collections/_superusers/auth-with-password', sec] if ident.include?('@')
        candidates << ['collections/users/auth-with-password', sec]
      elsif ident.include?('@')
        candidates << ['collections/_superusers/auth-with-password', sec]
        candidates << ['collections/users/auth-with-password', sec]
      else
        candidates << ['collections/users/auth-with-password', sec]
        candidates << ['collections/_superusers/auth-with-password', sec]
      end

      last_msg = 'Sai tài khoản, PIN hoặc mật khẩu.'
      candidates.each do |path, pw|
        res = http_post_json("#{base_url}/api/#{path}", { 'identity' => ident, 'password' => pw })
        if res[:code] == 200 && res[:data]['token'].to_s != ''
          token = res[:data]['token'].to_s
          rec = res[:data]['record'] || {}
          disp = rec['name'].to_s.strip
          disp = rec['username'].to_s.strip if disp.empty?
          disp = rec['email'].to_s.strip if disp.empty?
          disp = ident if disp.empty?
          write_pref('api_base', base_url)
          write_pref('auth_token', token)
          write_pref('auth_identity', ident)
          write_pref('auth_name', disp)
          return { 'token' => token, 'name' => disp, 'identity' => ident }
        elsif res[:data]['message'].to_s != '' && res[:code] >= 500
          last_msg = "Lỗi máy chủ (#{res[:code]}): #{res[:data]['message']}"
          break
        end
      end

      raise last_msg
    end

    def build_export_items(model, targets, payload)
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

      raise 'Chưa có món nào được tích chọn để xuất.' if chosen_targets.empty?

      all_fadi = payload['target_library'] == 'fadi' || chosen_targets.all? { |t| t[:group] == 'fadi' }
      exported_items = chosen_targets.map do |t|
        res = export_single_target(model, t, payload)
        res.delete('daeXml')
        if payload['target_library'] == 'fadi' || res['group'] == 'fadi'
          res['library'] = 'fadi'
          res['group'] = 'fadi'
        end
        res
      end
      [chosen_targets, exported_items, all_fadi]
    end

    def perform_export_mkglib(model, targets, payload)
      chosen_targets, exported_items, all_fadi = build_export_items(model, targets, payload)
      default_file = chosen_targets.length == 1 ? "#{slugify(chosen_targets[0][:name])}.mkglib.json" : 'MKG_ThuVien_SketchUp.mkglib.json'
      default_file = chosen_targets.length == 1 ? "#{slugify(chosen_targets[0][:name])}.mkglib.json" : 'FADI_ThuVien_SketchUp.mkglib.json' if all_fadi
      out_path = UI.savepanel('Lưu gói Thư viện MKG (.mkglib.json)', '', default_file)
      return false unless out_path && !out_path.empty?

      out_path = "#{out_path}.mkglib.json" unless out_path.downcase.end_with?('.json')

      pkg = {
        'app'        => 'MKG_SKETCHUP_EXPORT',
        'version'    => 1,
        'exportedAt' => Time.now.utc.iso8601,
        'exporter'   => "#{PLUGIN_ID}/#{PLUGIN_VERSION}",
        'items'      => exported_items
      }
      pkg['library'] = 'fadi' if all_fadi

      File.binwrite(out_path, JSON.pretty_generate(pkg).encode('UTF-8'))
      UI.messagebox(
        "Đã xuất thành công #{exported_items.length} món nội thất (chỉ Solid & màu sắc)!\n\n" \
        "File: #{out_path}"
      )
      true
    rescue StandardError => e
      loc = e.backtrace && !e.backtrace.empty? ? "\n(#{e.backtrace[0]})" : ''
      UI.messagebox("Lỗi khi xuất thư viện MKG:\n#{e.message}#{loc}")
      false
    end

    def perform_export_cloud(model, targets, payload)
      base_url = normalize_api_base(payload['api_base'] || read_pref('api_base', DEFAULT_API_BASE))
      token = read_pref('auth_token', '')
      ident = payload['identity'].to_s.strip
      sec = payload['secret'].to_s.strip

      if !ident.empty? && !sec.empty?
        auth_res = cloud_authenticate!(base_url, ident, sec)
        token = auth_res['token']
      elsif token.empty?
        raise 'Chưa đăng nhập tài khoản do.mkg.vn — hãy nhập Email/Username và PIN hoặc Mật khẩu.'
      else
        write_pref('api_base', base_url)
      end

      _chosen, exported_items, all_fadi = build_export_items(model, targets, payload)
      req_body = {
        'library' => all_fadi ? 'fadi' : 'auto',
        'items'   => exported_items
      }

      res = http_post_json("#{base_url}/api/catalog/sketchup-import", req_body, token)
      if res[:code] == 401
        write_pref('auth_token', '')
        if !ident.empty? && !sec.empty?
          auth_res = cloud_authenticate!(base_url, ident, sec)
          res = http_post_json("#{base_url}/api/catalog/sketchup-import", req_body, auth_res['token'])
        else
          raise 'Phiên đăng nhập đã hết hạn — vui lòng nhập lại tài khoản/PIN.'
        end
      end

      unless res[:code] >= 200 && res[:code] < 300
        msg = res[:data]['message'].to_s
        msg = "HTTP #{res[:code]}: #{res[:raw][0, 180]}" if msg.empty?
        raise msg
      end

      count = (res[:data]['count'] || exported_items.length).to_i
      libs = Array(res[:data]['catalogs']).map { |k| k == 'fadi' ? 'Thư viện FADI' : 'Kho chung' }.uniq.join(' + ')
      libs = all_fadi ? 'Thư viện FADI' : 'Kho chung' if libs.empty?
      { ok: true, count: count, libs: libs, base_url: base_url }
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
      res = export_single_target(model, target, { 'include_svg' => false, 'solid_only' => true, 'front_axis' => '-Y' })
      File.binwrite(out_path, res['daeXml'].encode('UTF-8'))
      UI.messagebox("Đã xuất file .DAE sạch (#{res['w']}×#{res['d']}×#{res['h']} mm):\n#{out_path}")
    rescue StandardError => e
      UI.messagebox("Lỗi xuất .DAE: #{e.message}")
    end

    def show_guide_dialog
      UI.messagebox(
        "HƯỚNG DẪN XUẤT MODEL SKETCHUP THẲNG LÊN MKG KHẢO SÁT (do.mkg.vn)\n\n" \
        "1. Đóng gói mỗi món nội thất thành 1 Group hoặc Component riêng.\n" \
        "2. Plugin tự động lọc sạch chỉ giữ khối Solid & màu sắc (bỏ qua Tag Label, chữ, dim, ốc cam chốt liên kết).\n" \
        "3. Chọn 1 hoặc nhiều món cùng lúc → bấm icon MKG hoặc chuột phải → Xuất thẳng lên Thư viện.\n" \
        "4. Đăng nhập tài khoản/PIN 1 lần duy nhất → bấm \"Xuất thẳng lên Thư viện\" (không cần mở Backend PC)."
      )
    end

    def reload(show_toast: false)
      @active_dialog.close rescue nil
      @active_dialog = nil
      @export_busy = false
      base_dir = File.dirname(__dir__)
      loader_rb = File.join(base_dir, 'mkg_khaosat_exporter.rb')
      main_rb = File.join(__dir__, 'main.rb')
      if File.exist?(loader_rb)
        load loader_rb
      elsif File.exist?(main_rb)
        load main_rb
      end
      ver = defined?(PLUGIN_VERSION) ? PLUGIN_VERSION : '1.1.1'
      puts "[MKG Khảo Sát] Đã reload plugin v#{ver} lúc #{Time.now.strftime('%H:%M:%S')}!"
      UI.messagebox("Đã reload plugin MKG Khảo Sát v#{ver}!") if show_toast
      ver
    rescue StandardError => e
      UI.messagebox("Lỗi reload MKG Khảo Sát:\n#{e.message}") if show_toast
      puts "[MKG Khảo Sát] Lỗi reload: #{e.message}"
      nil
    end
    alias reload! reload

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
        t0 = targets[0]
        prompts = ['Tên món:', 'Nhóm (bedroom/living/kitchen/wc/elec/other/fadi):', 'Kiểu lắp (floor/wall/ceiling):', 'Cao độ Z (mm):', 'Áp tường (true/false):']
        defaults = [t0[:name], t0[:group], t0[:mount], t0[:z].to_s, t0[:back].to_s]
        ans = UI.inputbox(prompts, defaults, 'MKG Khảo Sát — Xuất lên Thư viện')
        return unless ans
        t0[:name] = ans[0]
        t0[:group] = ans[1]
        t0[:mount] = ans[2]
        t0[:z] = ans[3].to_i
        t0[:back] = ans[4].to_s.downcase == 'true'
        perform_export_mkglib(model, [t0], { 'include_svg' => true, 'solid_only' => true, 'front_axis' => '-Y', 'items' => [] })
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
        'groups' => GROUPS,
        'auth' => {
          'api_base' => read_pref('api_base', DEFAULT_API_BASE),
          'identity' => read_pref('auth_identity', ''),
          'name' => read_pref('auth_name', ''),
          'connected' => !read_pref('auth_token', '').empty?
        }
      }

      @active_dialog.close rescue nil
      dlg = UI::HtmlDialog.new(
        dialog_title: "MKG Khảo Sát v#{PLUGIN_VERSION} — Xuất Thẳng Lên Thư Viện",
        preferences_key: 'com.mkg.khaosat.exporter',
        scrollable: true,
        resizable: true,
        width: 750,
        height: 610,
        min_width: 560,
        min_height: 460
      )
      @active_dialog = dlg
      dlg.set_on_closed { @active_dialog = nil } if dlg.respond_to?(:set_on_closed)

      @export_busy = false

      dlg.add_action_callback('exportMkg') do |_ctx, json_str|
        next if @export_busy
        @export_busy = true
        begin
          payload = JSON.parse(json_str.to_s)
          mode = payload['mode'] || 'cloud'
          if mode == 'file'
            dlg.close
            perform_export_mkglib(model, targets, payload)
          else
            res = perform_export_cloud(model, targets, payload)
            dlg.close
            UI.messagebox(
              "Đã đẩy trực tiếp #{res[:count]} món nội thất lên Thư viện!\n\n" \
              "Máy chủ: #{res[:base_url]}\n" \
              "Danh mục: #{res[:libs]}\n\n" \
              "Trên web do.mkg.vn, bấm biểu tượng Làm mới (↻) trong bảng Thư viện hoặc mở lại mặt bằng để dùng ngay."
            )
          end
        rescue StandardError => e
          safe_msg = e.message.to_s.encode('UTF-8', invalid: :replace, undef: :replace, replace: '?')
          err_json = JSON.generate({ 'message' => safe_msg })
          dlg.execute_script("window.__mkgExportError && window.__mkgExportError((#{err_json}).message);")
        ensure
          @export_busy = false
        end
      end

      dlg.add_action_callback('logoutMkg') do |_ctx|
        write_pref('auth_token', '')
        write_pref('auth_name', '')
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
          .opts { display: grid; grid-template-columns: 1.15fr 1fr 1.25fr; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; align-items: center; }
          .opt-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
          .opt-item label { font-weight: 600; color: #334155; }
          .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; line-height: 1.35; }
          select, input[type="text"], input[type="password"], input[type="number"] { padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12.5px; width: 100%; background: #fff; }
          .auth-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px 12px; margin-bottom: 10px; }
          .auth-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 8px; align-items: end; }
          .auth-connected { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
          .auth-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 999px; }
          .err-box { margin-top: 8px; padding: 7px 10px; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 12px; font-weight: 600; display: none; }
          .tbl-wrap { max-height: 250px; overflow: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; font-size: 12.5px; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; position: sticky; top: 0; z-index: 2; }
          td.center, th.center { text-align: center; }
          .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px; flex-wrap: wrap; }
          .note { color: #64748b; font-size: 11.5px; }
          .btns { display: flex; gap: 6px; flex-wrap: wrap; }
          button { padding: 7px 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-weight: 600; font-size: 12.5px; }
          button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
          button.primary:hover:not(:disabled) { background: #1d4ed8; }
          button:disabled { opacity: 0.6; cursor: wait; }
        </style>
        </head>
        <body>
          <div class="hdr">
            <div>
              <h2>Xuất thẳng lên Thư viện 2D &amp; 3D — do.mkg.vn</h2>
              <small>Chỉ xuất khối Solid &amp; Màu sắc (bỏ Label, liên kết, dim, chữ) · Đẩy trực tiếp vào app không cần mở Backend</small>
            </div>
          </div>

          <div class="auth-card">
            <div id="authConnectedBox" class="auth-connected" style="display:none">
              <div class="auth-badge">● Đã kết nối: <span id="authNameLbl"></span> (<span id="authHostLbl"></span>)</div>
              <button type="button" onclick="switchAccount()" style="font-size:11.5px;padding:4px 9px">Đổi tài khoản / PIN</button>
            </div>
            <div id="authLoginBox" class="auth-row">
              <div class="opt-item">
                <label for="authIdent">Tài khoản do.mkg.vn (Email / Username)</label>
                <input type="text" id="authIdent" placeholder="quy28181818@gmail.com hoặc KTS..." />
              </div>
              <div class="opt-item">
                <label for="authSecret">PIN (4-8 số) hoặc Mật khẩu</label>
                <input type="password" id="authSecret" placeholder="Nhập PIN hoặc mật khẩu" />
              </div>
              <div class="opt-item">
                <label for="apiBase">Máy chủ Cloud</label>
                <input type="text" id="apiBase" value="https://do.mkg.vn" />
              </div>
            </div>
            <div id="errBox" class="err-box"></div>
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
            <label class="chk"><input type="checkbox" id="solidOnly" checked /> Chỉ giữ khối Solid &amp; màu sắc (bỏ Label, liên kết)</label>
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
              <button type="button" onclick="assignAllFadi()" style="border-color:#f59e0b;color:#b45309;background:#fffbeb">Vào FADI</button>
              <button type="button" onclick="sketchup.cancelDialog()">Huỷ</button>
              <button type="button" id="btnSaveFile" onclick="doExport('file')">Lưu .mkglib.json</button>
              <button type="button" id="btnExport" class="primary" onclick="doExport('cloud')">Xuất thẳng lên Thư viện</button>
            </div>
          </div>

          <script>
            const DATA = #{json_bootstrap};
            const tbody = document.getElementById('rows');
            const summary = document.getElementById('summary');
            const chkAll = document.getElementById('chkAll');
            const btnExport = document.getElementById('btnExport');
            const btnSaveFile = document.getElementById('btnSaveFile');
            const errBox = document.getElementById('errBox');
            const authConnectedBox = document.getElementById('authConnectedBox');
            const authLoginBox = document.getElementById('authLoginBox');
            const authIdent = document.getElementById('authIdent');
            const authSecret = document.getElementById('authSecret');
            const apiBase = document.getElementById('apiBase');
            let exporting = false;
            let connected = !!(DATA.auth && DATA.auth.connected);

            function syncAuthUI() {
              if (DATA.auth && DATA.auth.api_base) apiBase.value = DATA.auth.api_base;
              if (DATA.auth && DATA.auth.identity) authIdent.value = DATA.auth.identity;
              if (connected) {
                document.getElementById('authNameLbl').textContent = (DATA.auth && DATA.auth.name) || authIdent.value || 'MKG';
                document.getElementById('authHostLbl').textContent = apiBase.value || 'https://do.mkg.vn';
                authConnectedBox.style.display = 'flex';
                authLoginBox.style.display = 'none';
              } else {
                authConnectedBox.style.display = 'none';
                authLoginBox.style.display = 'grid';
              }
            }

            function switchAccount() {
              connected = false;
              authSecret.value = '';
              sketchup.logoutMkg();
              syncAuthUI();
              authIdent.focus();
            }

            window.__mkgExportError = function(msg) {
              exporting = false;
              btnExport.disabled = false;
              btnSaveFile.disabled = false;
              btnExport.textContent = 'Xuất thẳng lên Thư viện';
              errBox.textContent = msg || 'Có lỗi xảy ra khi đẩy lên Cloud';
              errBox.style.display = 'block';
              if (/đăng nhập|hết hạn|tài khoản|PIN/i.test(errBox.textContent)) {
                connected = false;
                syncAuthUI();
              }
            };

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
              summary.textContent = `Đã chọn ${cnt} / ${DATA.items.length} đối tượng`;
            }

            chkAll.addEventListener('change', () => {
              DATA.items.forEach(it => { it.enabled = chkAll.checked; });
              render();
            });

            function assignAllFadi() {
              DATA.items.forEach(it => { it.group = 'fadi'; });
              render();
            }

            function doExport(mode) {
              if (exporting) return;
              errBox.style.display = 'none';
              if (mode === 'cloud' && !connected) {
                if (!authIdent.value.trim() || !authSecret.value.trim()) {
                  errBox.textContent = 'Nhập Tài khoản và PIN/Mật khẩu để đẩy thẳng lên thư viện do.mkg.vn.';
                  errBox.style.display = 'block';
                  return;
                }
              }
              exporting = true;
              btnExport.disabled = true;
              btnSaveFile.disabled = true;
              btnExport.textContent = mode === 'cloud' ? 'Đang đẩy lên Cloud…' : 'Đang xuất file…';
              const enabledItems = DATA.items.filter(x => x.enabled);
              const allFadi = enabledItems.length > 0 && enabledItems.every(x => x.group === 'fadi');
              const payload = {
                mode: mode || 'cloud',
                api_base: apiBase.value.trim(),
                identity: connected ? '' : authIdent.value.trim(),
                secret: connected ? '' : authSecret.value.trim(),
                front_axis: document.getElementById('frontAxis').value,
                include_svg: document.getElementById('incSvg').checked,
                solid_only: document.getElementById('solidOnly').checked,
                target_library: allFadi ? 'fadi' : 'auto',
                items: DATA.items
              };
              sketchup.exportMkg(JSON.stringify(payload));
            }

            syncAuthUI();
            render();
          </script>
        </body>
        </html>
      HTML
    end

    unless file_loaded?(__FILE__)
      cmd_pkg = UI::Command.new('Xuất thẳng lên Thư viện MKG (do.mkg.vn)') { open_export_dialog }
      cmd_pkg.tooltip = 'MKG Khảo Sát: Xuất Group/Component đang chọn thẳng lên Thư viện 2D + 3D (do.mkg.vn)'
      cmd_pkg.status_bar_text = 'Xuất trực tiếp 1 hoặc nhiều món nội thất từ SketchUp lên thư viện do.mkg.vn'
      cmd_pkg.menu_text = 'Xuất thẳng lên Thư viện MKG (do.mkg.vn) — 2D + 3D'

      icon_24 = File.join(plugin_dir, 'icons', 'mkg_24.png')
      icon_32 = File.join(plugin_dir, 'icons', 'mkg_32.png')
      cmd_pkg.small_icon = icon_24 if File.exist?(icon_24)
      cmd_pkg.large_icon = icon_32 if File.exist?(icon_32)

      cmd_dae = UI::Command.new('Xuất nhanh 3D COLLADA (.dae)') { quick_export_dae }
      cmd_dae.tooltip = 'Xuất nhanh 1 món sang .dae chuẩn hoá gốc toạ độ'

      cmd_help = UI::Command.new('Hướng dẫn hệ trục & Model') { show_guide_dialog }
      cmd_reload = UI::Command.new('Reload MKG Khảo Sát') { reload(show_toast: true) }

      menu = UI.menu('Extensions').add_submenu('MKG Khảo Sát (do.mkg.vn)')
      menu.add_item(cmd_pkg)
      menu.add_item(cmd_dae)
      menu.add_separator
      menu.add_item(cmd_reload)
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
          context_menu.add_item('MKG Khảo Sát: Xuất thẳng món này lên Thư viện (do.mkg.vn)') { open_export_dialog }
        end
      end

      file_loaded(__FILE__)
    end
  end
end

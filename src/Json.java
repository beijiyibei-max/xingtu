import java.util.*;

/** Small strict JSON codec for the bounded evidence-file format. */
public final class Json {
    public static Object parse(String text) {
        Parser p = new Parser(text);
        Object result = p.value(0); p.space();
        if (p.i != text.length()) throw new IllegalArgumentException("JSON 尾部存在多余内容");
        return result;
    }
    public static String stringify(Object value) {
        if (value == null) return "null";
        if (value instanceof String) {
            StringBuilder b = new StringBuilder("\"");
            for (char c : ((String)value).toCharArray()) {
                if (c == '"' || c == '\\') b.append('\\').append(c);
                else if (c < 32) b.append(String.format("\\u%04x", (int)c));
                else b.append(c);
            }
            return b.append('"').toString();
        }
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        if (value instanceof Map) {
            StringJoiner j = new StringJoiner(",", "{", "}");
            for (Map.Entry<?,?> e : ((Map<?,?>)value).entrySet()) j.add(stringify(e.getKey().toString()) + ":" + stringify(e.getValue()));
            return j.toString();
        }
        if (value instanceof List) {
            StringJoiner j = new StringJoiner(",", "[", "]");
            for (Object e : (List<?>)value) j.add(stringify(e));
            return j.toString();
        }
        throw new IllegalArgumentException("不可编码的 JSON 类型");
    }
    private static final class Parser {
        final String s; int i;
        Parser(String s) { this.s = s; }
        void space() { while(i < s.length() && " \t\r\n".indexOf(s.charAt(i)) >= 0) i++; }
        boolean take(char c) { space(); if(i < s.length() && s.charAt(i)==c) {i++;return true;} return false; }
        void require(char c) { if(!take(c)) throw error(); }
        IllegalArgumentException error() { return new IllegalArgumentException("JSON 格式错误，位置 " + i); }
        Object value(int depth) {
            if(depth > 20) throw new IllegalArgumentException("JSON 嵌套过深");
            space(); if(i >= s.length()) throw error(); char c=s.charAt(i);
            if(c=='"') return string();
            if(c=='{') {
                i++; Map<String,Object> map=new LinkedHashMap<String,Object>(); if(take('}'))return map;
                do {space();String key=string();require(':');if(map.containsKey(key))throw new IllegalArgumentException("JSON 重复字段");map.put(key,value(depth+1));} while(take(','));
                require('}');return map;
            }
            if(c=='[') {i++;List<Object> list=new ArrayList<Object>();if(take(']'))return list;do {list.add(value(depth+1));}while(take(','));require(']');return list;}
            for(String literal: new String[]{"true","false","null"}) if(s.startsWith(literal,i)){i+=literal.length();return literal.equals("null")?null:Boolean.valueOf(literal);}
            java.util.regex.Matcher m=java.util.regex.Pattern.compile("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?").matcher(s.substring(i));
            if(m.lookingAt()){i+=m.end();return new java.math.BigDecimal(m.group());}
            throw error();
        }
        String string() {
            if(i>=s.length()||s.charAt(i++)!='"')throw error();StringBuilder b=new StringBuilder();
            while(i<s.length()) {
                char c=s.charAt(i++);if(c=='"')return b.toString();if(c<32)throw error();
                if(c=='\\') {
                    if(i>=s.length())throw error();char e=s.charAt(i++);
                    switch(e) {
                        case '"':case '\\':case '/':b.append(e);break;
                        case 'b':b.append('\b');break;case 'f':b.append('\f');break;
                        case 'n':b.append('\n');break;case 'r':b.append('\r');break;case 't':b.append('\t');break;
                        case 'u':if(i+4>s.length())throw error();try{b.append((char)Integer.parseInt(s.substring(i,i+4),16));}catch(NumberFormatException ex){throw error();}i+=4;break;
                        default:throw error();
                    }
                } else b.append(c);
            }
            throw error();
        }
    }
}

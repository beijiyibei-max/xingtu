import java.util.*;
final class EvidenceSchema {
    private static final Set<String> STATES=new HashSet<String>(Arrays.asList("pass","fail","pending","unknown","forbidden","error","absent","notApplicable"));
    private static final Set<String> CAP_IDS=new HashSet<String>(Arrays.asList("redis-ha","redis-single","platform-ha","ai-capability","s3-backend","es-cluster","kafka-ha","mysql-ha","nacos-cluster","starrocks","csi-s3","task-operators","gpu-sharing","gravitino","cert-manager","zookeeper-ha","postgresql-ha","minio-distributed","registry","ingress-entry","monitoring","logging-pipeline","plugin-distribution","backup","resource-limits"));
    @SuppressWarnings("unchecked")
    static Map<String,Object> validate(Object input) {
        if(!(input instanceof Map))throw new IllegalArgumentException("证据必须是对象");Map<String,Object> snap=(Map<String,Object>)input;
        allowed(snap,"schemaVersion","projectId","clusterId","namespace","generatedAt","capabilities");
        if(!(snap.get("schemaVersion") instanceof Number)||((Number)snap.get("schemaVersion")).doubleValue()!=2.0)throw new IllegalArgumentException("需要 schemaVersion=2");
        for(String key:new String[]{"projectId","clusterId","namespace","generatedAt"})text(snap,key,100);
        if(!(snap.get("capabilities") instanceof List))throw new IllegalArgumentException("capabilities 必须是数组");
        List<?> caps=(List<?>)snap.get("capabilities");if(caps.size()>100)throw new IllegalArgumentException("能力项过多");Set<String> ids=new HashSet<String>();
        for(Object item:caps) {
            if(!(item instanceof Map))throw new IllegalArgumentException("能力项格式错误");Map<String,Object> cap=(Map<String,Object>)item;
            allowed(cap,"id","evidence","reasons","validation");String id=text(cap,"id",80);
            if(!CAP_IDS.contains(id)||!ids.add(id))throw new IllegalArgumentException("未知或重复能力 id");
            if(!(cap.get("evidence") instanceof Map))throw new IllegalArgumentException("缺少 evidence");Map<String,Object> e=(Map<String,Object>)cap.get("evidence");
            allowed(e,"object","configuration","function");for(String key:new String[]{"object","configuration","function"})if(!STATES.contains(text(e,key,30)))throw new IllegalArgumentException("证据状态非法");
            if(cap.containsKey("validation")){if(!(cap.get("validation") instanceof Map))throw new IllegalArgumentException("validation 格式错误");Map<String,Object> v=(Map<String,Object>)cap.get("validation");allowed(v,"method","checkedAt","source");text(v,"method",40);text(v,"checkedAt",100);if(v.containsKey("source"))text(v,"source",80);}
            if("pass".equals(e.get("function"))&&(!(cap.get("validation") instanceof Map)||!"business-retest".equals(((Map<?,?>)cap.get("validation")).get("method"))))throw new IllegalArgumentException("功能通过需要业务复测记录");
            if(cap.containsKey("reasons")){if(!(cap.get("reasons") instanceof List)||((List<?>)cap.get("reasons")).size()>10)throw new IllegalArgumentException("reasons 格式错误");for(Object reason:(List<?>)cap.get("reasons"))if(!(reason instanceof String)||((String)reason).length()>300)throw new IllegalArgumentException("reason 过长或无效");}
        }
        return snap;
    }
    private static String text(Map<String,Object> map,String key,int max){Object v=map.get(key);if(!(v instanceof String)||((String)v).trim().isEmpty()||((String)v).length()>max||((String)v).matches("(?s).*\\p{Cntrl}.*"))throw new IllegalArgumentException("无效字段："+key);return (String)v;}
    private static void allowed(Map<String,Object> map,String... keys){Set<String> set=new HashSet<String>(Arrays.asList(keys));for(String key:map.keySet())if(!set.contains(key))throw new IllegalArgumentException("不允许的字段："+key);}
}

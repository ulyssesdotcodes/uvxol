# me - this DAT
# 
# comp - the replicator component which is cooking
# allOps - a list of all replicants, created or existing
# newOps - the subset that were just created
# template - table DAT specifying the replicator attributes
# master - the master operator
#

def onRemoveReplicant(comp, replicant):
  replicant.destroy()
  return

def onReplicate(comp, allOps, newOps, template, master):

  for i, c in enumerate(newOps):
    #c.name = template[i, 0] + "_CONTENT_composite"
    c.outputConnectors[0].connect(op('house_autoswitch'))
    pass

  return

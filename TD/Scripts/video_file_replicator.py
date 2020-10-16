# me - this DAT
# 
# comp - the replicator component which is cooking
# allOps - a list of all replicants, created or existing
# newOps - the subset that were just created
# template - table DAT specifying the replicator attributes
# master - the master operator
#

def onRemoveReplicant(comp, replicant):

  if op("playing_files")[replicant.name, 0] == None:
    replicant.destroy()
  return

def onReplicate(comp, allOps, newOps, template, master):
  audio = op("all_audio")
  for i, c in enumerate(allOps):
    name = template[i, 0].val.partition(".")[0]
    if c in newOps:
      target_location = template[i, 1] + "_" + template[i, 2]
      if c.par.File != template[i, 3]:
        c.par.File = template[i, 3]
      target = op(target_location + "_composite")
      c.outputConnectors[0].connect(target)
      c.outputConnectors[1].connect(audio)

  return
